const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.zvqmptcxkmoxkkrpepbk:%5BDIepNN%402024%5D@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false },
    family: 4
});

// Khởi tạo DB (giữ nguyên cấu trúc cũ của bạn)[cite: 3]
async function initDB() {
    // ... (Giữ nguyên toàn bộ logic initDB() hiện tại của bạn)
}
initDB();

io.on('connection', (socket) => {
    console.log('Một thiết bị đã kết nối Realtime WebSocket');
});

// Khi thêm món tại bàn -> Gửi tên bàn cho toàn bộ máy
const handleAddOrder = (req, res) => {
    const { room_id, item_id, quantity } = req.body;
    pool.query(`SELECT price FROM menu WHERE id = $1`, [item_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const item = result.rows[0];
        if (!item) return res.status(400).json({ error: 'Món không tồn tại' });
        const total_price = item.price * quantity;
        
        pool.query(`INSERT INTO orders (room_id, item_id, quantity, total_price) VALUES ($1, $2, $3, $4)`, [room_id, item_id, quantity, total_price], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            
            pool.query(`SELECT room_name FROM rooms WHERE id = $1`, [room_id], (err3, roomRes) => {
                if (!err3 && roomRes.rows[0]) {
                    io.emit('order_added', { roomName: roomRes.rows[0].room_name });
                }
            });

            res.json({ success: true });
        });
    });
};

app.post('/api/orders', handleAddOrder);
app.post('/api/orders/add', handleAddOrder);

// Khi có đơn hàng online mới -> Báo "có đơn hàng online"
app.post('/api/online-orders/submit', (req, res) => {
    const { customer_name, customer_phone, delivery_address, items } = req.body;
    if (!customer_name || !customer_phone || !delivery_address || !items || items.length === 0) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
    }

    const goods_total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const currentDate = new Date().toISOString().split('T')[0];

    pool.query(`INSERT INTO online_orders (customer_name, customer_phone, delivery_address, items_detail, goods_total, shipping_fee, grand_total, status, created_date) VALUES ($1, $2, $3, $4, $5, 0, $6, 'Chờ xác nhận', $7) RETURNING id`,
        [customer_name, customer_phone, delivery_address, JSON.stringify(items), goods_total, goods_total, currentDate], (err, result) => {
            if (err) return res.status(500).json({ error: 'Lỗi lưu đơn hàng' });
            
            io.emit('online_order_new');
            res.json({ success: true, orderId: result.rows[0].id });
        });
});

// Khi xác thực thanh toán thành công -> Báo "đã thanh toán bàn..."
app.post('/api/rooms/confirm-paid', (req, res) => {
    const { room_id, payment_method } = req.body;
    const method = payment_method || 'Tiền mặt';

    pool.query(`SELECT * FROM promotions LIMIT 1`, (err2, promoRes) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const promo = promoRes.rows[0];
        const discountPercent = (promo && promo.active === 1) ? (promo.discount_percent || 0) : 0;

        pool.query(`SELECT * FROM rooms WHERE id = $1`, [room_id], (err3, roomRes) => {
            if (err3) return res.status(500).json({ error: err3.message });
            const room = roomRes.rows[0];
            if (!room || room.status === 'Trống') return res.status(400).json({ error: 'Bàn đang trống!' });

            pool.query(`SELECT o.*, m.item_name, m.category, m.unit, m.import_price FROM orders o JOIN menu m ON o.item_id = m.id WHERE o.room_id = $1`, [room_id], async (err4, orderItemsRes) => {
                if (err4) return res.status(500).json({ error: err4.message });
                const items = orderItemsRes.rows || [];
                const goodsTotal = items.reduce((sum, item) => sum + item.total_price, 0);
                const discountAmount = goodsTotal * discountPercent / 100;
                const grandTotal = goodsTotal - discountAmount;
                const totalImportCost = items.reduce((sum, item) => sum + (item.import_price * item.quantity), 0);
                const currentDate = new Date().toISOString().split('T')[0];
                const roomName = room.room_name;

                try {
                    await pool.query(`INSERT INTO bills (room_name, goods_total, discount_percent, discount_amount, grand_total, total_import_cost, items_detail, created_date, shipping_fee, order_type, payment_method) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 'Tại bàn', $9)`,
                        [roomName, goodsTotal, discountPercent, discountAmount, grandTotal, totalImportCost, JSON.stringify(items), currentDate, method]);
                    
                    for (const item of items) {
                        await pool.query(`UPDATE inventory SET quantity = GREATEST(0, quantity - $1) WHERE item_name = $2`, [item.quantity, item.item_name]);
                    }

                    await pool.query(`UPDATE rooms SET status = 'Trống', customer_name = NULL WHERE id = $1`, [room_id]);
                    await pool.query(`DELETE FROM orders WHERE room_id = $1`, [room_id]);

                    io.emit('room_paid', { roomName: roomName });
                    res.json({ success: true });
                } catch (errDb) {
                    res.status(500).json({ error: errDb.message });
                }
            });
        });
    });
});

// Giữ lại các API khác của bạn...
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
