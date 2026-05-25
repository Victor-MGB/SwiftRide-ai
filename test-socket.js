const { io } = require("./node_modules/socket.io-client");

const TOKEN = process.env.JWT_SECRET_TOKEN;  

const socket = io("http://localhost:3002", {
    auth: { token: TOKEN },
    transports: ['websocket'],
    timeout: 10000,
    reconnection: false
});

socket.on("connect", () => {
    console.log(" Connected successfully!");
    console.log("Socket ID:", socket.id);
    socket.emit("ping");
});

socket.on("pong", (time) => {
    console.log("✅ Ping-Pong received from server!");
});

socket.on("auth_success", (data) => {
    console.log("✅ Auth Success:", data);
});

socket.on("connect_error", (err) => {
    console.log("❌ Connection Error:", err.message);
});

socket.on("auth_error", (err) => {
    console.log("❌ Auth Error:", err.message);
});

setTimeout(() => {
    if (socket.connected) {
        console.log("✅ Test completed successfully.");
    } else {
        console.log("❌ Could not connect. Make sure the Socket.IO server is running on port 3002.");
    }
    socket.disconnect();
    process.exit(0);
}, 8000);
