const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Lỗi kết nối DB:', err.message);
    else console.log('Đã kết nối cơ sở dữ liệu SQLite thành công.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'staff'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        address TEXT,
        phone TEXT,
        qr_code TEXT,
        banners TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        discount_percent REAL DEFAULT 0,
        active INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_name TEXT,
        status TEXT DEFAULT 'Trống',
        customer_name TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS menu (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT,
        category TEXT,
        unit TEXT,
        import_price REAL DEFAULT 0,
        price REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER,
        item_id INTEGER,
        quantity INTEGER,
        total_price REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT,
        category TEXT,
        quantity INTEGER,
        unit TEXT,
        import_price REAL,
        import_date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    db.run(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        amount REAL,
        note TEXT,
        date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS online_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO users (username, password, role) VALUES ('admin', '123456', 'admin')`);
            db.run(`INSERT INTO users (username, password, role) VALUES ('nhanvien', '123456', 'staff')`);
            db.run(`INSERT INTO settings (name, address, phone, qr_code, banners) VALUES ('Karaoke CALI', '123 Đường Karaoke, Cà Mau', '0909123456', 'https://api.vietqr.io/image/970422-123456789-n5398FP.jpg', 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7')`);
            db.run(`INSERT INTO promotions (content, discount_percent, active) VALUES ('Giảm giá 10% giờ hát cho mọi khách hàng!', 10, 1)`);
            for (let i = 1; i <= 8; i++) {
                db.run(`INSERT INTO rooms (room_name, status) VALUES ('Bàn 0${i}', 'Trống')`);
            }
        } else {
            db.run(`ALTER TABLE promotions ADD COLUMN discount_percent REAL DEFAULT 0`, (err) => {});
            db.run(`ALTER TABLE bills ADD COLUMN goods_total REAL DEFAULT 0`, (err) => {});
            db.run(`ALTER TABLE bills ADD COLUMN discount_percent REAL DEFAULT 0`, (err) => {});
            db.run(`ALTER TABLE bills ADD COLUMN discount_amount REAL DEFAULT 0`, (err) => {});
        }
    });
});

// API Khuyến mãi
app.get('/api/promotions', (req, res) => {
    db.get(`SELECT * FROM promotions LIMIT 1`, (err, row) => {
        res.json(row || { content: '', discount_percent: 0, active: 1 });
    });
});

app.post('/api/admin/promotions', (req, res) => {
    const { content, discount_percent, active } = req.body;
    db.get(`SELECT COUNT(*) as count FROM promotions`, (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO promotions (content, discount_percent, active) VALUES (?, ?, ?)`, [content, discount_percent || 0, active ? 1 : 0], () => {
                res.json({ success: true, message: 'Đã lưu khuyến mãi thành công!' });
            });
        } else {
            db.run(`UPDATE promotions SET content = ?, discount_percent = ?, active = ? WHERE id = 1`, [content, discount_percent || 0, active ? 1 : 0], () => {
                res.json({ success: true, message: 'Đã cập nhật khuyến mãi thành công!' });
            });
        }
    });
});

// Đăng nhập & Tài khoản
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
        if (!row) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu!' });
        res.json({ success: true, user: { username: row.username, role: row.role } });
    });
});

app.get('/api/users', (req, res) => {
    db.all(`SELECT id, username, role FROM users`, (err, rows) => res.json(rows || []));
});

app.post('/api/users/save', (req, res) => {
    const { id, username, password, role } = req.body;
    if(id) {
        db.run(`UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?`, [username, password, role, id], () => res.json({ success: true }));
    } else {
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, [username, password, role], (err) => {
            if (err) return res.status(400).json({ error: 'Tên tài khoản đã tồn tại!' });
            res.json({ success: true });
        });
    }
});

app.delete('/api/users/:id', (req, res) => {
    db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
});

// Cài đặt chung & Banners
app.get('/api/settings', (req, res) => {
    db.get(`SELECT * FROM settings LIMIT 1`, (err, row) => res.json(row || {}));
});

app.post('/api/settings', (req, res) => {
    const { name, address, phone, qr_code, banners } = req.body;
    db.run(`UPDATE settings SET name = ?, address = ?, phone = ?, qr_code = ?, banners = ? WHERE id = 1`, [name, address, phone, qr_code, banners], () => res.json({ success: true }));
});

app.get('/api/banners', (req, res) => {
    db.get(`SELECT banners FROM settings LIMIT 1`, (err, row) => {
        if (!row || !row.banners) return res.json([]);
        const bannerList = row.banners.split('\n').map(b => b.trim()).filter(b => b.length > 0);
        res.json(bannerList);
    });
});

// Quản lý Bàn
app.get('/api/rooms', (req, res) => {
    db.all(`SELECT * FROM rooms`, (err, rows) => res.json(rows || []));
});

app.post('/api/admin/rooms/save', (req, res) => {
    const { id, room_name } = req.body;
    if (id) {
        db.run(`UPDATE rooms SET room_name = ? WHERE id = ?`, [room_name, id], () => res.json({ success: true }));
    } else {
        db.run(`INSERT INTO rooms (room_name, status) VALUES (?, 'Trống')`, [room_name], () => res.json({ success: true }));
    }
});

app.delete('/api/admin/rooms/:id', (req, res) => {
    db.get(`SELECT status FROM rooms WHERE id = ?`, [req.params.id], (err, row) => {
        if (row && row.status === 'Đang phục vụ') {
            return res.status(400).json({ error: 'Không thể xóa bàn đang có khách phục vụ!' });
        }
        db.run(`DELETE FROM rooms WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
    });
});

app.post('/api/rooms/book', (req, res) => {
    const { room_id, customer_name } = req.body;
    db.run(`UPDATE rooms SET status = 'Đang phục vụ', customer_name = ? WHERE id = ?`, [customer_name || 'Khách lẻ', room_id], () => {
        res.json({ success: true });
    });
});

// Tính tiền bàn (Áp dụng giảm giá % khuyến mãi)
app.post('/api/rooms/checkout', (req, res) => {
    const { room_id } = req.body;
    db.get(`SELECT * FROM settings LIMIT 1`, (err, setting) => {
        db.get(`SELECT * FROM promotions LIMIT 1`, (err, promo) => {
            const discountPercent = (promo && promo.active === 1) ? (promo.discount_percent || 0) : 0;

            db.get(`SELECT * FROM rooms WHERE id = ?`, [room_id], (err, room) => {
                if (!room || room.status === 'Trống') return res.status(400).json({ error: 'Bàn đang trống!' });

                db.all(`SELECT o.*, m.item_name, m.category, m.unit, m.import_price FROM orders o JOIN menu m ON o.item_id = m.id WHERE o.room_id = ?`, [room_id], (err, orderItems) => {
                    const items = orderItems || [];
                    const goodsTotal = items.reduce((sum, item) => sum + item.total_price, 0);
                    const discountAmount = goodsTotal * discountPercent / 100;
                    const grandTotal = goodsTotal - discountAmount;
                    const totalImportCost = items.reduce((sum, item) => sum + (item.import_price * item.quantity), 0);
                    const currentDate = new Date().toISOString().split('T')[0];

                    db.run(`INSERT INTO bills (room_name, goods_total, discount_percent, discount_amount, grand_total, total_import_cost, items_detail, created_date, shipping_fee, order_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'Tại bàn')`,
                        [room.room_name, goodsTotal, discountPercent, discountAmount, grandTotal, totalImportCost, JSON.stringify(items), currentDate], () => {
                        
                        items.forEach(item => {
                            db.run(`UPDATE inventory SET quantity = MAX(0, quantity - ?) WHERE item_name = ?`, [item.quantity, item.item_name]);
                        });

                        db.run(`UPDATE rooms SET status = 'Trống', customer_name = NULL WHERE id = ?`, [room_id], () => {
                            db.run(`DELETE FROM orders WHERE room_id = ?`, [room_id], () => {
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

    db.run(`INSERT INTO online_orders (customer_name, customer_phone, delivery_address, items_detail, goods_total, shipping_fee, grand_total, status, created_date) VALUES (?, ?, ?, ?, ?, 0, ?, 'Chờ xác nhận', ?)`,
        [customer_name, customer_phone, delivery_address, JSON.stringify(items), goods_total, goods_total, currentDate], function(err) {
            if (err) return res.status(500).json({ error: 'Lỗi lưu đơn hàng' });
            res.json({ success: true, orderId: this.lastID });
        });
});

app.get('/api/admin/online-orders', (req, res) => {
    db.all(`SELECT * FROM online_orders ORDER BY id DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/admin/online-orders/checkout', (req, res) => {
    const { order_id, shipping_fee } = req.body;
    db.get(`SELECT * FROM online_orders WHERE id = ?`, [order_id], (err, order) => {
        if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng!' });

        db.get(`SELECT * FROM promotions LIMIT 1`, (err, promo) => {
            const discountPercent = (promo && promo.active === 1) ? (promo.discount_percent || 0) : 0;
            const shipFee = parseFloat(shipping_fee) || 0;
            const goodsTotal = order.goods_total;
            const discountAmount = goodsTotal * discountPercent / 100;
            const grandTotal = (goodsTotal - discountAmount) + shipFee;
            const items = JSON.parse(order.items_detail);
            const totalImportCost = 0;

            db.get(`SELECT * FROM settings LIMIT 1`, (err, setting) => {
                db.run(`INSERT INTO bills (room_name, goods_total, discount_percent, discount_amount, grand_total, total_import_cost, items_detail, created_date, shipping_fee, order_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Online')`,
                    [`Online: ${order.customer_name} (${order.customer_phone})`, goodsTotal, discountPercent, discountAmount, grandTotal, totalImportCost, order.items_detail, order.created_date, shipFee], () => {
                    
                    items.forEach(item => {
                        db.run(`UPDATE inventory SET quantity = MAX(0, quantity - ?) WHERE item_name = ?`, [item.quantity, item.item_name]);
                    });

                    db.run(`UPDATE online_orders SET shipping_fee = ?, grand_total = ?, status = 'Đã hoàn thành' WHERE id = ?`, [shipFee, grandTotal, order_id], () => {
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

// Danh sách hóa đơn & In lại bill
app.get('/api/bills', (req, res) => {
    const { start_date, end_date } = req.query;
    let query = `SELECT * FROM bills`;
    let params = [];
    if (start_date && end_date) {
        query += ` WHERE created_date BETWEEN ? AND ?`;
        params = [start_date, end_date];
    }
    query += ` ORDER BY id DESC`;
    db.all(query, params, (err, rows) => res.json(rows || []));
});

// Báo cáo doanh thu & Lợi nhuận (Đã gộp giá trị tồn kho vào tổng chi phí)
app.get('/api/reports/revenue', (req, res) => {
    const { start_date, end_date } = req.query;
    let billQuery = `SELECT SUM(grand_total) as totalRevenue, SUM(total_import_cost) as totalImport FROM bills`;
    let expQuery = `SELECT SUM(amount) as totalExp FROM expenses`;
    let params = [];

    if (start_date && end_date) {
        billQuery += ` WHERE created_date BETWEEN ? AND ?`;
        expQuery += ` WHERE date BETWEEN ? AND ?`;
        params = [start_date, end_date];
    }

    db.get(billQuery, params, (err, billRow) => {
        db.get(expQuery, params, (err, expRow) => {
            db.all(`SELECT quantity, import_price FROM inventory`, (err, inventoryRows) => {
                const totalRevenue = billRow?.totalRevenue || 0;
                const totalImport = billRow?.totalImport || 0;
                const grossProfit = totalRevenue - totalImport;
                
                const totalExpenseRecord = expRow?.totalExp || 0;
                const totalInventoryCost = (inventoryRows || []).reduce((sum, item) => sum + ((item.quantity || 0) * (item.import_price || 0)), 0);
                
                // Tổng chi phí = Chi phí thực tế + Giá trị tồn hàng
                const totalExpense = totalExpenseRecord + totalInventoryCost;
                const netProfit = grossProfit - totalExpense;

                res.json({ totalRevenue, totalImport, grossProfit, totalExpense, netProfit });
            });
        });
    });
});

// Xuất file Excel .xlsx (Tổng chi phí bao gồm chi phí + tồn kho)
app.get('/api/reports/export-excel', (req, res) => {
    const { start_date, end_date } = req.query;
    let billQuery = `SELECT * FROM bills`;
    let expQuery = `SELECT * FROM expenses`;
    let params = [];

    if (start_date && end_date) {
        billQuery += ` WHERE created_date BETWEEN ? AND ?`;
        expQuery += ` WHERE date BETWEEN ? AND ?`;
        params = [start_date, end_date];
    }

    db.all(billQuery, params, (err, bills) => {
        db.all(expQuery, params, (err, expenses) => {
            db.all(`SELECT * FROM inventory`, (err, inventory) => {
                const totalRev = bills.reduce((s, b) => s + b.grand_total, 0);
                const totalImport = bills.reduce((s, b) => s + b.total_import_cost, 0);
                const totalExpRecord = expenses.reduce((s, e) => s + e.amount, 0);
                
                const totalInventoryCost = inventory.reduce((s, i) => s + ((i.quantity || 0) * (i.import_price || 0)), 0);
                const totalExp = totalExpRecord + totalInventoryCost;
                const netProfit = (totalRev - totalImport) - totalExp;

                // Sheet 1: Baocao_Tongquat
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

                // Sheet 2: Chitiet_Hoadon
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

                // Sheet 3: Baocao_Tonkho
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

                // Sheet 4: Chiphi
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
    db.all(`SELECT * FROM menu`, (err, rows) => res.json(rows || []));
});

app.post('/api/menu/save', (req, res) => {
    const { id, item_name, category, unit, import_price, price } = req.body;
    if(id) {
        db.run(`UPDATE menu SET item_name = ?, category = ?, unit = ?, import_price = ?, price = ? WHERE id = ?`, 
            [item_name, category, unit, import_price || 0, price, id], () => res.json({ success: true }));
    } else {
        db.run(`INSERT INTO menu (item_name, category, unit, import_price, price) VALUES (?, ?, ?, ?, ?)`, 
            [item_name, category, unit, import_price || 0, price], () => res.json({ success: true }));
    }
});

app.delete('/api/menu/:id', (req, res) => {
    db.run(`DELETE FROM menu WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
});

// Orders
app.get('/api/orders/:room_id', (req, res) => {
    db.all(`SELECT o.id, m.item_name, m.category, m.unit, o.quantity, o.total_price FROM orders o JOIN menu m ON o.item_id = m.id WHERE o.room_id = ?`, [req.params.room_id], (err, rows) => res.json(rows || []));
});

app.post('/api/orders', (req, res) => {
    const { room_id, item_id, quantity } = req.body;
    db.get(`SELECT price FROM menu WHERE id = ?`, [item_id], (err, item) => {
        if (!item) return res.status(400).json({ error: 'Món không tồn tại' });
        const total_price = item.price * quantity;
        db.run(`INSERT INTO orders (room_id, item_id, quantity, total_price) VALUES (?, ?, ?, ?)`, [room_id, item_id, quantity, total_price], () => res.json({ success: true }));
    });
});

// Inventory
app.get('/api/inventory', (req, res) => {
    db.all(`SELECT * FROM inventory`, (err, rows) => res.json(rows || []));
});

app.post('/api/inventory', (req, res) => {
    const { item_name, category, quantity, unit, import_price, import_date } = req.body;
    db.run(`INSERT INTO inventory (item_name, category, quantity, unit, import_price, import_date) VALUES (?, ?, ?, ?, ?, ?)`, 
        [item_name, category, quantity, unit, import_price, import_date || new Date().toISOString().split('T')[0]], () => {
        db.get(`SELECT * FROM menu WHERE item_name = ?`, [item_name], (err, row) => {
            const sellPrice = import_price * 1.3;
            if (!row) {
                db.run(`INSERT INTO menu (item_name, category, unit, import_price, price) VALUES (?, ?, ?, ?, ?)`, 
                    [item_name, category, unit, import_price, sellPrice]);
            }
        });
        res.json({ success: true });
    });
});

app.post('/api/inventory/update', (req, res) => {
    const { id, quantity, import_price } = req.body;
    db.run(`UPDATE inventory SET quantity = ?, import_price = ? WHERE id = ?`, [quantity, import_price, id], () => {
        res.json({ success: true });
    });
});

app.delete('/api/inventory/:id', (req, res) => {
    db.run(`DELETE FROM inventory WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
});

// Expenses
app.get('/api/expenses', (req, res) => {
    db.all(`SELECT * FROM expenses ORDER BY id DESC`, (err, rows) => res.json(rows || []));
});

app.post('/api/expenses', (req, res) => {
    const { category, amount, note, date } = req.body;
    db.run(`INSERT INTO expenses (category, amount, note, date) VALUES (?, ?, ?, ?)`, [category, amount, note, date || new Date().toISOString().split('T')[0]], () => res.json({ success: true }));
});

app.delete('/api/expenses/:id', (req, res) => {
    db.run(`DELETE FROM expenses WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
});

app.listen(PORT, () => console.log(`Server đang chạy tại cổng ${PORT}`));