const io = require('socket.io-client');

const socket = io('http://localhost:3002', {
    transports: ['websocket']
});

socket.on('connect', () => {
    console.log('Connected to WebSocket server');
    
    // Authenticate (use token from quick test)
    const token = 'YOUR_ACCESS_TOKEN_HERE';
    socket.emit('auth', { token });
});

socket.on('auth_success', (data) => {
    console.log('Authenticated as:', data);
    
    // Request a ride
    socket.emit('rider:request:ride', {
        pickupLat: 40.7128,
        pickupLng: -74.0060,
        dropoffLat: 40.7580,
        dropoffLng: -73.9855
    });
});

socket.on('ride:request:success', (data) => {
    console.log('Ride accepted! Driver:', data.driverId, 'ETA:', data.eta);
});

socket.on('driver:location:update', (data) => {
    console.log('Driver location updated:', data.lat, data.lng);
});

socket.on('ride:completed', (data) => {
    console.log('Ride completed! Fare:', data.finalPrice);
    socket.disconnect();
});

socket.on('disconnect', () => {
    console.log('Disconnected');
});