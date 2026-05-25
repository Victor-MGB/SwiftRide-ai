import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { config } from './config.js';

export let options = {
    stages: [
        { duration: '1m', target: 100 },
        { duration: '3m', target: 500 },
        { duration: '5m', target: 1000 },
        { duration: '2m', target: 0 },
    ],
};

export default function() {
    const userId = `ws_user_${__VU}_${__ITER}`;
    
    const url = `${config.wsUrl}?token=test_token`;
    const response = ws.connect(url, {}, function(socket) {
        socket.on('open', function() {
            console.log(`Connected: ${userId}`);
            
            // Authenticate
            socket.send(JSON.stringify({
                event: 'auth',
                token: 'test_token'
            }));
            
            // Join ride room
            socket.send(JSON.stringify({
                event: 'join:ride',
                rideId: `test_ride_${__VU}`
            }));
            
            // Simulate driver location updates
            let interval = setInterval(() => {
                socket.send(JSON.stringify({
                    event: 'driver:location:live',
                    lat: 40.7128 + (Math.random() - 0.5) * 0.01,
                    lng: -74.0060 + (Math.random() - 0.5) * 0.01,
                    status: 'online'
                }));
            }, 3000);
            
            // Simulate ride request
            setTimeout(() => {
                socket.send(JSON.stringify({
                    event: 'rider:request:ride',
                    pickupLat: 40.7128,
                    pickupLng: -74.0060,
                    dropoffLat: 40.7580,
                    dropoffLng: -73.9855
                }));
            }, 2000);
            
            // Clean up interval on close
            socket.on('close', function() {
                clearInterval(interval);
                console.log(`Disconnected: ${userId}`);
            });
        });
        
        socket.on('message', function(message) {
            const data = JSON.parse(message);
            check(data, {
                'message received': (d) => d !== null,
            });
        });
        
        socket.on('error', function(e) {
            console.error(`WebSocket error: ${e}`);
        });
    });
    
    check(response, {
        'WebSocket connected': (r) => r && r.status === 101,
    });
    
    sleep(30);
}