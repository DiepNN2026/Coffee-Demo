const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Kết nối PostgreSQL (Supabase Session Pooler cổng 6543, ép IPv4 với family: 4)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.zvqmptcxkmoxkkrpepbk:%5BDIepNN%402024%5D@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres',
    ssl: {
        rejectUnauthorized: false
    },
    family: 4 // Ép buộc sử dụng IPv4 để tránh lỗi ENETUNREACH trên Render
});

// Khởi tạo cơ sở dữ liệu và bảng dữ liệu mẫu
async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'staff'
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS settings (
            id SERIAL PRIMARY KEY,
            name TEXT,
            address TEXT,
            phone TEXT,
            qr_code TEXT,
            banners TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS promotions (
            id SERIAL PRIMARY KEY,
            content TEXT,
            discount_percent REAL DEFAULT 0,
            active INTEGER DEFAULT 1
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS rooms (
            id SERIAL PRIMARY KEY,
            room_name TEXT,
            status TEXT DEFAULT 'Trống',
            customer_name TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS menu (
            id SERIAL PRIMARY KEY,
            item_name TEXT,
            category TEXT,
            unit TEXT,
            import_price REAL DEFAULT 0,
            price REAL
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            room_id INTEGER,
            item_id INTEGER,
            quantity INTEGER,
            total_price REAL
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS inventory (
            id SERIAL PRIMARY KEY,
            item_name TEXT,
            category TEXT,
            quantity INTEGER,
            unit TEXT,
            import_price REAL,
            import_date TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS bills (
            id SERIAL PRIMARY KEY,
            room_name TEXT,
            goods_total REAL DEFAULT 0,
            discount_percent REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            grand_total REAL,
            total_import_cost REAL,
            items_detail TEXT,
            created_date TEXT,
            shipping_fee REAL DEFAULT 0,
            order_type TEXT DEFAULT 'Tại bàn'
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS expenses (
            id SERIAL PRIMARY KEY,
            category TEXT,
            amount REAL,
            note TEXT,
            date TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS online_orders (
            id SERIAL PRIMARY KEY,
            customer_name TEXT,
            customer_phone TEXT,
            delivery_address TEXT,
            items_detail TEXT,
            goods_total REAL,
            shipping_fee REAL DEFAULT 0,
            grand_total REAL,
            status TEXT DEFAULT 'Chờ xác nhận',
            created_date TEXT
        )`);

        // Seed dữ liệu mặc định nếu bảng users trống
        const userCountRes = await pool.query(`SELECT COUNT(*) as count FROM users`);
        if (parseInt(userCountRes.rows[0].count) === 0) {
            await pool.query(`INSERT INTO users (username, password, role) VALUES ('admin', '123456', 'admin')`);
            await pool.query(`INSERT INTO users (username, password, role) VALUES ('nhanvien', '123456', 'staff')`);
            await pool.query(`INSERT INTO settings (name, address, phone, qr_code, banners) VALUES ('Karaoke CALI', '123 Đường Karaoke, Cà Mau', '0909123456', 'https://api.vietqr.io/image/970422-123456789-n5398FP.jpg', 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7')`);
            await pool.query(`INSERT INTO promotions (content, discount_percent, active) VALUES ('Giảm giá 10% giờ hát cho mọi khách hàng!', 10, 1)`);
            for (let i = 1; i <= 8; i++) {
                await pool.query(`INSERT INTO rooms (room_name, status) VALUES ($1, 'Trống')`, [`Bàn 0${i}`]);
            }
        }
        console.log('Đã kết nối và khởi tạo cơ sở dữ liệu PostgreSQL thành công.');
    } catch (err) {
        console.error('Lỗi khởi tạo DB:', err.message);
    }
}
initDB();

// API Khuyến mãi
app.get('/api/promotions', (req, res) => {
    pool.query(`SELECT * FROM promotions LIMIT 1`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows[0] || { content: '', discount_percent: 0, active: 1 });
    });
});

app.post('/api/admin/promotions', (req, res) => {
    const { content, discount_percent, active } = req.body;
    pool.query(`SELECT COUNT(*) as count FROM promotions`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const count = parseInt(result.rows[0].count);
        if (count === 0) {
            pool.query(`INSERT INTO promotions (content, discount_percent, active) VALUES ($1, $2, $3)`, [content, discount_percent || 0, active ? 1 : 0], (err2) => {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ success: true, message: 'Đã lưu khuyến mãi thành công!' });
            });
        } else {
            pool.query(`UPDATE promotions SET content = $1, discount_percent = $2, active = $3 WHERE id = 1`, [content, discount_percent || 0, active ? 1 : 0], (err2) => {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ success: true, message: 'Đã cập nhật khuyến mãi thành công!' });
            });
        }
    });
});

// Đăng nhập & Tài khoản
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    pool.query(`SELECT * FROM users WHERE username = $1 AND password = $2`, [username, password], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const row = result.rows[0];
        if (!row) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu!' });
        res.json({ success: true, user: { username: row.username, role: row.role } });
    });
});

app.get('/api/users', (req, res) => {
    pool.query(`SELECT id, username, role FROM users`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

app.post('/api/users/save', (req, res) => {
    const { id, username, password, role } = req.body;
    if(id) {
        pool.query(`UPDATE users SET username = $1, password = $2, role = $3 WHERE id = $4`, [username, password, role, id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    } else {
        pool.query(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3)`, [username, password, role], (err) => {
            if (err) return res.status(400).json({ error: 'Tên tài khoản đã tồn tại!' });
            res.json({ success: true });
        });
    }
});

app.delete('/api/users/:id', (req, res) => {
    pool.query(`DELETE FROM users WHERE id = $1`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Cài đặt chung & Banners
app.get('/api/settings', (req, res) => {
    pool.query(`SELECT * FROM settings LIMIT 1`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows[0] || {});
    });
});

app.post('/api/settings', (req, res) => {
    const { name, address, phone, qr_code, banners } = req.body;
    pool.query(`UPDATE settings SET name = $1, address = $2, phone = $3, qr_code = $4, banners = $5 WHERE id = 1`, [name, address, phone, qr_code, banners], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/banners', (req, res) => {
    pool.query(`SELECT banners FROM settings LIMIT 1`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const row = result.rows[0];
        if (!row || !row.banners) return res.json([]);
        const bannerList = row.banners.split('\n').map(b => b.trim()).filter(b => b.length > 0);
        res.json(bannerList);
    });
});

// Quản lý Bàn
app.get('/api/rooms', (req, res) => {
    pool.query(`SELECT * FROM rooms ORDER BY id`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

app.post('/api/admin/rooms/save', (req, res) => {
    const { id, room_name } = req.body;
    if (id) {
        pool.query(`UPDATE rooms SET room_name = $1 WHERE id = $2`, [room_name, id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    } else {
        pool.query(`INSERT INTO rooms (room_name, status) VALUES ($1, 'Trống')`, [room_name], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    }
});

app.delete('/api/admin/rooms/:id', (req, res) => {
    pool.query(`SELECT status FROM rooms WHERE id = $1`, [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const row = result.rows[0];
        if (row && row.status === 'Đang phục vụ') {
            return res.status(400).json({ error: 'Không thể xóa bàn đang có khách phục vụ!' });
        }
        pool.query(`DELETE FROM rooms WHERE id = $1`, [req.params.id], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true });
        });
    });
});

app.post('/api/rooms/book', (req, res) => {
    const { room_id, customer_name } = req.body;
    pool.query(`UPDATE rooms SET status = 'Đang phục vụ', customer_name = $1 WHERE id = $2`, [customer_name || 'Khách lẻ', room_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Tính tiền bàn
app.post('/api/rooms/checkout', (req, res) => {
    const { room_id } = req.body;
    pool.query(`SELECT * FROM settings LIMIT 1`, (err, settingRes) => {
        if (err) return res.status(500).json({ error: err.message });
        const setting = settingRes.rows[0];
        pool.query(`SELECT * FROM promotions LIMIT 1`, (err2, promoRes) => {
            if (err2) return res.status(500).json({ error: err2.message });
            const promo = promoRes.rows[0];
            const discountPercent = (promo && promo.active === 1) ? (promo.discount_percent || 0) : 0;

            pool.query(`SELECT * FROM rooms WHERE id = $1`, [room_id], (err3, roomRes) => {
                if (err3) return res.status(500).json({ error: err3.message });
                const room = roomRes.rows[0];
                if (!room || room.status === 'Trống') return res.status(400).json({ error: 'Bàn đang trống!' });

                pool.query(`SELECT o.*, m.item_name, m.category, m.unit, m.import_price FROM orders o JOIN menu m ON o.item_id = m.id WHERE o.room_id = $1`, [room_id], (err4, orderItemsRes) => {
                    if (err4) return res.status(500).json({ error: err4.message });
                    const items = orderItemsRes.rows || [];
                    const goodsTotal = items.reduce((sum, item) => sum + item.total_price, 0);
                    const discountAmount = goodsTotal * discountPercent / 100;
                    const grandTotal = goodsTotal - discountAmount;
                    const totalImportCost = items.reduce((sum, item) => sum + (item.import_price * item.quantity), 0);
                    const currentDate = new Date().toISOString().split('T')[0];

                    pool.query(`INSERT INTO bills (room_name, goods_total, discount_percent, discount_amount, grand_total, total_import_cost, items_detail, created_date, shipping_fee, order_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 'Tại bàn')`,
                        [room.room_name, goodsTotal, discountPercent, discountAmount, grandTotal, totalImportCost, JSON.stringify(items), currentDate], async (err5) => {
                        if (err5) return res.status(500).json({ error: err5.message });
                        
                        for (const item of items) {
                            await pool.query(`UPDATE inventory SET quantity = GREATEST(0, quantity - $1) WHERE item_name = $2`, [item.quantity, item.item_name]);
                        }

                        pool.query(`UPDATE rooms SET status = 'Trống', customer_name = NULL WHERE id = $1`, [room_id], (err6) => {
                            if (err6) return res.status(500).json({ error: err6.message });
                            pool.query(`DELETE FROM orders WHERE room_id = $1`, [room_id], (err7) => {
                                if (err7) return res.status(500).json({ error: err7.message });
                                res.json({
                                    success: true,
                                    setting: setting || {},
                                    report: { room_name: room.room_name, items, goodsTotal, discountPercent, discountAmount, grandTotal, shippingFee: 0 }
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// Đơn hàng Online
app.post('/api/online-orders/submit', (req, res) => {
    const { customer_name, customer_phone, delivery_address, items } = req.body;
    if (!customer_name || !customer_phone || !delivery_address || !items || items.length === 0) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin giao hàng và chọn món!' });
    }

    const goods_total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const currentDate = new Date().toISOString().split('T')[0];

    pool.query(`INSERT INTO online_orders (customer_name, customer_phone, delivery_address, items_detail, goods_total, shipping_fee, grand_total, status, created_date) VALUES ($1, $2, $3, $4, $5, 0, $6, 'Chờ xác nhận', $7) RETURNING id`,
        [customer_name, customer_phone, delivery_address, JSON.stringify(items), goods_total, goods_total, currentDate], (err, result) => {
            if (err) return res.status(500).json({ error: 'Lỗi lưu đơn hàng' });
            res.json({ success: true, orderId: result.rows[0].id });
        });
});

app.get('/api/admin/online-orders', (req, res) => {
    pool.query(`SELECT * FROM online_orders ORDER BY id DESC`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

app.post('/api/admin/online-orders/checkout', (req, res) => {
    const { order_id, shipping_fee } = req.body;
    pool.query(`SELECT * FROM online_orders WHERE id = $1`, [order_id], (err, orderRes) => {
        if (err) return res.status(500).json({ error: err.message });
        const order = orderRes.rows[0];
        if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng!' });

        pool.query(`SELECT * FROM promotions LIMIT 1`, (err2, promoRes) => {
            if (err2) return res.status(500).json({ error: err2.message });
            const promo = promoRes.rows[0];
            const discountPercent = (promo && promo.active === 1) ? (promo.discount_percent || 0) : 0;
            const shipFee = parseFloat(shipping_fee) || 0;
            const goodsTotal = order.goods_total;
            const discountAmount = goodsTotal * discountPercent / 100;
            const grandTotal = (goodsTotal - discountAmount) + shipFee;
            const items = JSON.parse(order.items_detail);
            const totalImportCost = 0;

            pool.query(`SELECT * FROM settings LIMIT 1`, (err3, settingRes) => {
                if (err3) return res.status(500).json({ error: err3.message });
                const setting = settingRes.rows[0];
                pool.query(`INSERT INTO bills (room_name, goods_total, discount_percent, discount_amount, grand_total, total_import_cost, items_detail, created_date, shipping_fee, order_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Online')`,
                    [`Online: ${order.customer_name} (${order.customer_phone})`, goodsTotal, discountPercent, discountAmount, grandTotal, totalImportCost, order.items_detail, order.created_date, shipFee], async (err4) => {
                    if (err4) return res.status(500).json({ error: err4.message });
                    
                    for (const item of items) {
                        await pool.query(`UPDATE inventory SET quantity = GREATEST(0, quantity - $1) WHERE item_name = $2`, [item.quantity, item.item_name]);
                    }

                    pool.query(`UPDATE online_orders SET shipping_fee = $1, grand_total = $2, status = 'Đã hoàn thành' WHERE id = $3`, [shipFee, grandTotal, order_id], (err5) => {
                        if (err5) return res.status(500).json({ error: err5.message });
                        res.json({
                            success: true,
                            setting: setting || {},
                            report: {
                                room_name: `Giao hàng: ${order.customer_name} - SĐT: ${order.customer_phone} - ĐC: ${order.delivery_address}`,
                                items: items.map(i => ({ item_name: i.item_name, quantity: i.quantity, unit: i.unit || 'phần', total_price: i.price * i.quantity })),
                                goodsTotal: goodsTotal,
                                discountPercent: discountPercent,
                                discountAmount: discountAmount,
                                shippingFee: shipFee,
                                grandTotal: grandTotal
                            }
                        });
                    });
                });
            });
        });
    });
});

// Danh sách hóa đơn
app.get('/api/bills', (req, res) => {
    const { start_date, end_date } = req.query;
    let query = `SELECT * FROM bills`;
    let params = [];
    if (start_date && end_date) {
        query += ` WHERE created_date BETWEEN $1 AND $2`;
        params = [start_date, end_date];
    }
    query += ` ORDER BY id DESC`;
    pool.query(query, params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

// Báo cáo doanh thu & Lợi nhuận
app.get('/api/reports/revenue', (req, res) => {
    const { start_date, end_date } = req.query;
    let billQuery = `SELECT SUM(grand_total) as totalRevenue, SUM(total_import_cost) as totalImport FROM bills`;
    let expQuery = `SELECT SUM(amount) as totalExp FROM expenses`;
    let params = [];

    if (start_date && end_date) {
        billQuery += ` WHERE created_date BETWEEN $1 AND $2`;
        expQuery += ` WHERE date BETWEEN $1 AND $2`;
        params = [start_date, end_date];
    }

    pool.query(billQuery, params, (err, billRes) => {
        if (err) return res.status(500).json({ error: err.message });
        pool.query(expQuery, params, (err2, expRes) => {
            if (err2) return res.status(500).json({ error: err2.message });
            pool.query(`SELECT quantity, import_price FROM inventory`, (err3, inventoryRes) => {
                if (err3) return res.status(500).json({ error: err3.message });
                const billRow = billRes.rows[0];
                const expRow = expRes.rows[0];
                const inventoryRows = inventoryRes.rows || [];

                const totalRevenue = parseFloat(billRow?.totalrevenue || 0);
                const totalImport = parseFloat(billRow?.totalimport || 0);
                const grossProfit = totalRevenue - totalImport;
                
                const totalExpenseRecord = parseFloat(expRow?.totalexp || 0);
                const totalInventoryCost = inventoryRows.reduce((sum, item) => sum + ((item.quantity || 0) * (item.import_price || 0)), 0);
                
                const totalExpense = totalExpenseRecord + totalInventoryCost;
                const netProfit = grossProfit - totalExpense;

                res.json({ totalRevenue, totalImport, grossProfit, totalExpense, netProfit });
            });
        });
    });
});

// Xuất file Excel .xlsx
app.get('/api/reports/export-excel', (req, res) => {
    const { start_date, end_date } = req.query;
    let billQuery = `SELECT * FROM bills`;
    let expQuery = `SELECT * FROM expenses`;
    let params = [];

    if (start_date && end_date) {
        billQuery += ` WHERE created_date BETWEEN $1 AND $2`;
        expQuery += ` WHERE date BETWEEN $1 AND $2`;
        params = [start_date, end_date];
    }

    pool.query(billQuery, params, (err, billRes) => {
        if (err) return res.status(500).json({ error: err.message });
        pool.query(expQuery, params, (err2, expRes) => {
            if (err2) return res.status(500).json({ error: err2.message });
            pool.query(`SELECT * FROM inventory`, (err3, invRes) => {
                if (err3) return res.status(500).json({ error: err3.message });
                const bills = billRes.rows || [];
                const expenses = expRes.rows || [];
                const inventory = invRes.rows || [];

                const totalRev = bills.reduce((s, b) => s + b.grand_total, 0);
                const totalImport = bills.reduce((s, b) => s + b.total_import_cost, 0);
                const totalExpRecord = expenses.reduce((s, e) => s + e.amount, 0);
                
                const totalInventoryCost = inventory.reduce((s, i) => s + ((i.quantity || 0) * (i.import_price || 0)), 0);
                const totalExp = totalExpRecord + totalInventoryCost;
                const netProfit = (totalRev - totalImport) - totalExp;

                const wsTongQuatData = [
                    ["BÁO CÁO TỔNG QUÁT DOANH THU & LỢI NHUẬN"],
                    ["Từ ngày:", start_date || "Tất cả", "Đến ngày:", end_date || "Tất cả"],
                    [],
                    ["Chỉ tiêu", "Số tiền (VNĐ)"],
                    ["Tổng Doanh Thu", totalRev],
                    ["Tổng Giá Vốn", totalImport],
                    ["Tổng Chi Phí (Gồm Chi Phí + Tồn Kho)", totalExp],
                    ["Lợi Nhuận Ròng", netProfit],
                    [],
                    ["Tổng", "", totalRev]
                ];

                const wsHoadonData = [
                    ["ID", "Tên Bàn / Khách", "Tiền Hàng", "% Giảm", "Tiền Giảm", "Tổng Tiền", "Phí Ship", "Loại Đơn", "Ngày Tạo"]
                ];
                let sumGoods = 0, sumDiscount = 0, sumGrand = 0, sumShip = 0;
                bills.forEach(b => {
                    sumGoods += (b.goods_total || 0);
                    sumDiscount += (b.discount_amount || 0);
                    sumGrand += b.grand_total;
                    sumShip += (b.shipping_fee || 0);
                    wsHoadonData.push([b.id, b.room_name, b.goods_total || 0, b.discount_percent || 0, b.discount_amount || 0, b.grand_total, b.shipping_fee || 0, b.order_type, b.created_date]);
                });
                wsHoadonData.push(["TỔNG", "", sumGoods, "", sumDiscount, sumGrand, sumShip, "", ""]);

                const wsTonkhoData = [
                    ["Tên Hàng", "Danh Mục", "Tồn Kho", "Đơn Vị", "Giá Nhập", "Thành Tiền Tồn Kho"]
                ];
                let sumInvQty = 0, sumInvTotal = 0;
                inventory.forEach(i => {
                    const thanhTien = i.quantity * i.import_price;
                    sumInvQty += i.quantity;
                    sumInvTotal += thanhTien;
                    wsTonkhoData.push([i.item_name, i.category, i.quantity, i.unit, i.import_price, thanhTien]);
                });
                wsTonkhoData.push(["TỔNG", "", sumInvQty, "", "", sumInvTotal]);

                const wsChiphiData = [
                    ["ID", "Loại Chi Phí", "Số Tiền", "Ghi Chú", "Thời Gian / Ngày Chi Trả"]
                ];
                let sumExp = 0;
                expenses.forEach(e => {
                    sumExp += e.amount;
                    wsChiphiData.push([e.id, e.category, e.amount, e.note || '', e.date]);
                });
                wsChiphiData.push(["TỔNG", "", sumExp, "", ""]);

                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsTongQuatData), "Baocao_Tongquat");
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsHoadonData), "Chitiet_Hoadon");
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsTonkhoData), "Baocao_Tonkho");
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsChiphiData), "Chiphi");

                const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
                res.setHeader('Content-Disposition', 'attachment; filename=BaoCaoDoanhThu.xlsx');
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.send(buffer);
            });
        });
    });
});

// Menu
app.get('/api/menu', (req, res) => {
    pool.query(`SELECT * FROM menu ORDER BY id`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

app.post('/api/menu/save', (req, res) => {
    const { id, item_name, category, unit, import_price, price } = req.body;
    if(id) {
        pool.query(`UPDATE menu SET item_name = $1, category = $2, unit = $3, import_price = $4, price = $5 WHERE id = $6`, 
            [item_name, category, unit, import_price || 0, price, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
    } else {
        pool.query(`INSERT INTO menu (item_name, category, unit, import_price, price) VALUES ($1, $2, $3, $4, $5)`, 
            [item_name, category, unit, import_price || 0, price], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
    }
});

app.delete('/api/menu/:id', (req, res) => {
    pool.query(`DELETE FROM menu WHERE id = $1`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Orders
app.get('/api/orders/:room_id', (req, res) => {
    pool.query(`SELECT o.id, m.item_name, m.category, m.unit, o.quantity, o.total_price FROM orders o JOIN menu m ON o.item_id = m.id WHERE o.room_id = $1`, [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

app.post('/api/orders/add', (req, res) => {
    const { room_id, item_id, quantity } = req.body;
    pool.query(`SELECT price FROM menu WHERE id = $1`, [item_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const item = result.rows[0];
        if (!item) return res.status(404).json({ error: 'Món ăn không tồn tại!' });
        const total_price = item.price * quantity;
        pool.query(`INSERT INTO orders (room_id, item_id, quantity, total_price) VALUES ($1, $2, $3, $4)`, [room_id, item_id, quantity, total_price], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true });
        });
    });
});

app.delete('/api/orders/:id', (req, res) => {
    pool.query(`DELETE FROM orders WHERE id = $1`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Quản lý Kho (Inventory)
app.get('/api/inventory', (req, res) => {
    pool.query(`SELECT * FROM inventory ORDER BY id`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

app.post('/api/inventory/save', (req, res) => {
    const { id, item_name, category, quantity, unit, import_price, import_date } = req.body;
    if (id) {
        pool.query(`UPDATE inventory SET item_name = $1, category = $2, quantity = $3, unit = $4, import_price = $5, import_date = $6 WHERE id = $7`,
            [item_name, category, quantity || 0, unit, import_price || 0, import_date, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
    } else {
        pool.query(`INSERT INTO inventory (item_name, category, quantity, unit, import_price, import_date) VALUES ($1, $2, $3, $4, $5, $6)`,
            [item_name, category, quantity || 0, unit, import_price || 0, import_date], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
    }
});

app.delete('/api/inventory/:id', (req, res) => {
    pool.query(`DELETE FROM inventory WHERE id = $1`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Quản lý Chi phí khác (Expenses)
app.get('/api/expenses', (req, res) => {
    pool.query(`SELECT * FROM expenses ORDER BY id DESC`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

app.post('/api/expenses/save', (req, res) => {
    const { id, category, amount, note, date } = req.body;
    if (id) {
        pool.query(`UPDATE expenses SET category = $1, amount = $2, note = $3, date = $4 WHERE id = $5`,
            [category, amount || 0, note, date, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
    } else {
        pool.query(`INSERT INTO expenses (category, amount, note, date) VALUES ($1, $2, $3, $4)`,
            [category, amount || 0, note, date], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
    }
});

app.delete('/api/expenses/:id', (req, res) => {
    pool.query(`DELETE FROM expenses WHERE id = $1`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Khởi chạy Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
