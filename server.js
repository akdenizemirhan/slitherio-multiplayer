const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ============== CONFIG ==============
const CONFIG = {
    WORLD_SIZE: 5000,
    FOOD_COUNT: 600,
    INITIAL_LENGTH: 10,
    SEGMENT_SPACING: 12,
    SNAKE_RADIUS: 12,
    FOOD_RADIUS: 6,
    BOOST_SPEED: 6,
    NORMAL_SPEED: 3.2,
    TURN_SPEED: 0.08,
    BOOST_DRAIN: 0.4,
    BOOST_RECHARGE: 0.15,
    BOT_COUNT: 10,
    BOT_TURN_SPEED: 0.05,
    TICK_RATE: 30,
};

const SNAKE_COLORS = [
    ['#ff0055','#ff3377','#ff0055'],
    ['#00ff88','#00ffaa','#00ff88'],
    ['#3366ff','#5588ff','#3366ff'],
    ['#ffaa00','#ffcc33','#ffaa00'],
    ['#ff00ff','#ff55ff','#ff00ff'],
    ['#00ffff','#55ffff','#00ffff'],
    ['#ff6600','#ff8833','#ff6600'],
    ['#aa00ff','#cc55ff','#aa00ff'],
    ['#ffff00','#ffff55','#ffff00'],
    ['#ff0000','#ff4444','#ff0000'],
    ['#00ff00','#44ff44','#00ff00'],
    ['#ff1493','#ff69b4','#ff1493'],
];

const BOT_NAMES = [
    'Cobra','Viper','Python','Mamba','Anaconda',
    'Boa','Rattler','Asp','Krait','Taipan',
    'Adder','Sidewinder','Copperhead','Coral','Kingsnake',
];

// ============== STATE ==============
const players = new Map();
let bots = [];
let foods = [];
let nextFoodId = 0;
let nextBotId = 0;
let tickEaten = [];
let tickSpawned = [];

// ============== SNAKE ==============
class Snake {
    constructor(id, name, isBot = false) {
        const half = CONFIG.WORLD_SIZE / 2 - 200;
        const x = (Math.random() - 0.5) * 2 * half;
        const y = (Math.random() - 0.5) * 2 * half;
        this.id = id;
        this.name = name;
        this.isBot = isBot;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.alive = true;
        this.boosting = false;
        this.boostEnergy = 100;
        this.score = 0;
        this.colorIndex = Math.floor(Math.random() * SNAKE_COLORS.length);
        this.colors = SNAKE_COLORS[this.colorIndex];
        this.speed = CONFIG.NORMAL_SPEED;
        this.botTimer = 0;
        this.segments = [];
        for (let i = 0; i < CONFIG.INITIAL_LENGTH; i++) {
            this.segments.push({
                x: x - Math.cos(this.angle) * i * CONFIG.SEGMENT_SPACING,
                y: y - Math.sin(this.angle) * i * CONFIG.SEGMENT_SPACING,
            });
        }
    }

    get x() { return this.segments[0].x; }
    get y() { return this.segments[0].y; }
    get length() { return this.segments.length; }
    get radius() { return CONFIG.SNAKE_RADIUS + Math.min(this.length * 0.15, 12); }

    grow(amount = 1) {
        for (let i = 0; i < amount; i++) {
            const last = this.segments[this.segments.length - 1];
            this.segments.push({ x: last.x, y: last.y });
        }
        this.score += amount;
    }

    update() {
        if (!this.alive) return;

        if (this.boosting && this.boostEnergy > 0) {
            this.speed = CONFIG.BOOST_SPEED;
            this.boostEnergy -= CONFIG.BOOST_DRAIN;
            if (this.boostEnergy <= 0) { this.boostEnergy = 0; this.boosting = false; }
            if (this.segments.length > 5 && Math.random() < 0.08) {
                const tail = this.segments.pop();
                spawnFood(tail.x, tail.y, this.colors[0]);
            }
        } else {
            this.speed = CONFIG.NORMAL_SPEED;
            if (this.boostEnergy < 100) this.boostEnergy += CONFIG.BOOST_RECHARGE;
        }

        let diff = this.targetAngle - this.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turnSpeed = this.isBot ? CONFIG.BOT_TURN_SPEED : CONFIG.TURN_SPEED;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), turnSpeed);

        const head = this.segments[0];
        const newX = head.x + Math.cos(this.angle) * this.speed;
        const newY = head.y + Math.sin(this.angle) * this.speed;

        const margin = 100;
        const halfWorld = CONFIG.WORLD_SIZE / 2;
        if (Math.abs(newX) > halfWorld - margin || Math.abs(newY) > halfWorld - margin) {
            if (!this.isBot) {
                this.segments[0] = {
                    x: Math.max(-halfWorld + margin, Math.min(halfWorld - margin, newX)),
                    y: Math.max(-halfWorld + margin, Math.min(halfWorld - margin, newY)),
                };
            } else {
                this.targetAngle = Math.atan2(-newY, -newX);
            }
        } else {
            this.segments[0] = { x: newX, y: newY };
        }

        for (let i = 1; i < this.segments.length; i++) {
            const prev = this.segments[i - 1];
            const curr = this.segments[i];
            const dx = prev.x - curr.x;
            const dy = prev.y - curr.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > CONFIG.SEGMENT_SPACING) {
                const ratio = CONFIG.SEGMENT_SPACING / dist;
                curr.x = prev.x - dx * ratio;
                curr.y = prev.y - dy * ratio;
            }
        }
    }

    die() {
        if (!this.alive) return;
        this.alive = false;
        for (let i = 0; i < this.segments.length; i += 2) {
            const seg = this.segments[i];
            spawnFood(seg.x + (Math.random() - 0.5) * 20, seg.y + (Math.random() - 0.5) * 20, this.colors[0]);
        }
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            segments: this.segments,
            angle: this.angle,
            alive: this.alive,
            boosting: this.boosting,
            boostEnergy: this.boostEnergy,
            score: this.score,
            colors: this.colors,
            colorIndex: this.colorIndex,
        };
    }
}

// ============== FOOD ==============
function spawnFood(x, y, color) {
    if (x === undefined) {
        const half = CONFIG.WORLD_SIZE / 2 - 100;
        x = (Math.random() - 0.5) * 2 * half;
        y = (Math.random() - 0.5) * 2 * half;
    }
    const food = {
        id: nextFoodId++,
        x, y,
        color: color || `hsl(${Math.random() * 360}, 100%, 60%)`,
        radius: CONFIG.FOOD_RADIUS + Math.random() * 3,
    };
    foods.push(food);
    tickSpawned.push(food);
    return food;
}

function initFoods() {
    foods = [];
    tickSpawned = [];
    for (let i = 0; i < CONFIG.FOOD_COUNT; i++) {
        const half = CONFIG.WORLD_SIZE / 2 - 100;
        const x = (Math.random() - 0.5) * 2 * half;
        const y = (Math.random() - 0.5) * 2 * half;
        foods.push({
            id: nextFoodId++,
            x, y,
            color: `hsl(${Math.random() * 360}, 100%, 60%)`,
            radius: CONFIG.FOOD_RADIUS + Math.random() * 3,
        });
    }
}

// ============== BOT AI ==============
function updateBotAI(bot) {
    if (!bot.alive) return;
    bot.botTimer--;

    let nearestFood = null;
    let nearestDist = Infinity;
    for (const food of foods) {
        const dx = food.x - bot.x;
        const dy = food.y - bot.y;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) { nearestDist = dist; nearestFood = food; }
    }

    let dangerDist = Infinity;
    let dangerAngle = null;
    const allSnakes = [...players.values(), ...bots].filter(s => s.alive && s !== bot);
    for (const snake of allSnakes) {
        for (let i = 0; i < Math.min(snake.segments.length, 30); i++) {
            const seg = snake.segments[i];
            const dx = seg.x - bot.x;
            const dy = seg.y - bot.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 80 && dist < dangerDist) { dangerDist = dist; dangerAngle = Math.atan2(dy, dx); }
        }
    }

    if (dangerDist < 60) {
        bot.targetAngle = dangerAngle + Math.PI;
        bot.boosting = dangerDist < 40 && bot.boostEnergy > 30;
    } else if (nearestFood) {
        bot.targetAngle = Math.atan2(nearestFood.y - bot.y, nearestFood.x - bot.x);
        bot.boosting = false;
    }

    if (bot.botTimer <= 0) {
        bot.botTimer = 60 + Math.random() * 120;
        if (Math.random() < 0.3) bot.targetAngle += (Math.random() - 0.5) * 1.5;
    }
}

// ============== COLLISION ==============
function checkCollisions() {
    const allSnakes = [...players.values(), ...bots].filter(s => s.alive);

    for (const snake of allSnakes) {
        if (!snake.alive) continue;

        for (let i = foods.length - 1; i >= 0; i--) {
            const food = foods[i];
            const dx = food.x - snake.x;
            const dy = food.y - snake.y;
            if (Math.sqrt(dx * dx + dy * dy) < snake.radius + food.radius) {
                snake.grow(1);
                tickEaten.push(food.id);
                foods.splice(i, 1);
                spawnFood();
            }
        }

        for (const other of allSnakes) {
            if (other === snake || !other.alive) continue;
            for (let i = 5; i < other.segments.length; i++) {
                const seg = other.segments[i];
                const dx = seg.x - snake.x;
                const dy = seg.y - snake.y;
                if (Math.sqrt(dx * dx + dy * dy) < snake.radius + other.radius - 4) {
                    snake.die();
                    other.grow(Math.floor(snake.length / 3));
                    if (!snake.isBot) {
                        io.to(snake.id).emit('died', { score: snake.score, length: snake.length });
                    }
                    break;
                }
            }
            if (!snake.alive) break;
        }
    }
}

// ============== INIT ==============
function initBots() {
    bots = [];
    for (let i = 0; i < CONFIG.BOT_COUNT; i++) {
        bots.push(new Snake('bot_' + (nextBotId++), BOT_NAMES[i % BOT_NAMES.length], true));
    }
}

// ============== GAME TICK ==============
function gameTick() {
    tickEaten = [];
    tickSpawned = [];

    for (const snake of players.values()) snake.update();
    for (const bot of bots) {
        if (bot.alive) { updateBotAI(bot); bot.update(); }
    }

    for (let i = 0; i < bots.length; i++) {
        if (!bots[i].alive) {
            bots[i] = new Snake('bot_' + (nextBotId++), BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], true);
        }
    }

    checkCollisions();
    while (foods.length < CONFIG.FOOD_COUNT) spawnFood();

    const snakeData = [
        ...Array.from(players.values()).map(s => s.toJSON()),
        ...bots.map(s => s.toJSON()),
    ];

    io.emit('state', {
        snakes: snakeData,
        eatenFoods: tickEaten,
        newFoods: tickSpawned,
    });
}

// ============== SOCKET ==============
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('join', (data) => {
        const snake = new Snake(socket.id, data.nickname || 'Oyuncu');
        players.set(socket.id, snake);
        socket.emit('joined', { id: socket.id, config: CONFIG });
        socket.emit('foodSync', foods);
    });

    socket.on('input', (data) => {
        const snake = players.get(socket.id);
        if (snake && snake.alive) {
            if (typeof data.angle === 'number' && isFinite(data.angle)) {
                snake.targetAngle = data.angle;
            }
            snake.boosting = !!data.boosting;
        }
    });

    socket.on('respawn', (data) => {
        const old = players.get(socket.id);
        if (old) old.die();
        const snake = new Snake(socket.id, data.nickname || 'Oyuncu');
        players.set(socket.id, snake);
        socket.emit('foodSync', foods);
    });

    socket.on('disconnect', () => {
        const snake = players.get(socket.id);
        if (snake) snake.die();
        players.delete(socket.id);
        console.log('Disconnected:', socket.id);
    });
});

// ============== START ==============
initFoods();
initBots();
setInterval(gameTick, 1000 / CONFIG.TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Slither.io server running on port ${PORT}`);
});
