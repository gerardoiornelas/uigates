const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');

// Game Constants
const TILE_SIZE = 20;
const GRID_WIDTH = 19;
const GRID_HEIGHT = 21;

canvas.width = TILE_SIZE * GRID_WIDTH;
canvas.height = TILE_SIZE * GRID_HEIGHT;

let score = 0;
let gameActive = true;
let gameStatus = 'playing'; // 'playing', 'won', 'lost'

// 0: Pellet, 1: Wall, 2: Empty
const map = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,0,1,0,1,1,1,1,1,0,1,0,1,1,0,1],
    [1,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,1],
    [1,1,1,1,0,1,1,1,2,1,2,1,1,1,0,1,1,1,1],
    [1,1,1,1,0,1,2,2,2,2,2,2,2,1,0,1,1,1,1],
    [1,1,1,1,0,1,2,1,1,2,1,1,2,1,0,1,1,1,1],
    [2,2,2,2,0,2,2,1,2,2,2,1,2,2,0,2,2,2,2],
    [1,1,1,1,0,1,2,1,1,1,1,1,2,1,0,1,1,1,1],
    [1,1,1,1,0,1,2,2,2,2,2,2,2,1,0,1,1,1,1],
    [1,1,1,1,0,1,0,1,1,1,1,1,0,1,0,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,0,1],
    [1,0,0,1,0,0,0,0,0,2,0,0,0,0,0,1,0,0,1],
    [1,1,0,1,0,1,0,1,1,1,1,1,0,1,0,1,0,1,1],
    [1,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,1],
    [1,0,1,1,1,1,1,1,0,1,0,1,1,1,1,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

function updateScore(points) {
    score += points;
    scoreElement.innerText = score;
}

// Player Object
const pacman = {
    x: 1,
    y: 1,
    dir: { x: 0, y: 0 },
    nextDir: { x: 0, y: 0 },
    speed: 1,
    radius: 8
};

// Ghost Object
const ghost = {
    x: 9,
    y: 9,
    dir: { x: 0, y: 0 },
    color: 'red',
    radius: 8
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') pacman.nextDir = { x: 0, y: -1 };
    if (e.key === 'ArrowDown') pacman.nextDir = { x: 0, y: 1 };
    if (e.key === 'ArrowLeft') pacman.nextDir = { x: -1, y: 0 };
    if (e.key === 'ArrowRight') pacman.nextDir = { x: 1, y: 0 };
});

function drawMap() {
    for (let row = 0; row < GRID_HEIGHT; row++) {
        for (let col = 0; col < GRID_WIDTH; col++) {
            const tile = map[row][col];
            const x = col * TILE_SIZE;
            const y = row * TILE_SIZE;

            if (tile === 1) {
                ctx.fillStyle = 'blue';
                ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            } else if (tile === 0) {
                ctx.fillStyle = 'white';
                ctx.beginPath();
                ctx.arc(x + TILE_SIZE/2, y + TILE_SIZE/2, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawPacman() {
    ctx.fillStyle = 'yellow';
    ctx.beginPath();
    ctx.arc(
        pacman.x * TILE_SIZE + TILE_SIZE/2,
        pacman.y * TILE_SIZE + TILE_SIZE/2,
        pacman.radius, 0, Math.PI * 2
    );
    ctx.fill();
}

function drawGhost() {
    ctx.fillStyle = ghost.color;
    ctx.beginPath();
    ctx.arc(
        ghost.x * TILE_SIZE + TILE_SIZE/2,
        ghost.y * TILE_SIZE + TILE_SIZE/2,
        ghost.radius, 0, Math.PI * 2
    );
    ctx.fill();
}

function updatePacman() {
    const nextX = pacman.x + pacman.nextDir.x;
    const nextY = pacman.y + pacman.nextDir.y;

    if (nextX >= 0 && nextX < GRID_WIDTH && nextY >= 0 && nextY < GRID_HEIGHT && map[nextY][nextX] !== 1) {
        pacman.dir = pacman.nextDir;
    }

    const moveX = pacman.x + pacman.dir.x;
    const moveY = pacman.y + pacman.dir.y;

    if (moveX >= 0 && moveX < GRID_WIDTH && moveY >= 0 && moveY < GRID_HEIGHT && map[moveY][moveX] !== 1) {
        pacman.x = moveX;
        pacman.y = moveY;

        if (map[pacman.y][pacman.x] === 0) {
            map[pacman.y][pacman.x] = 2;
            updateScore(10);
        }
    }
}

function updateGhost() {
    const dirs = [
        { x: 0, y: -1 }, { x: 0, y: 1 },
        { x: -1, y: 0 }, { x: 1, y: 0 }
    ];

    const nextX = ghost.x + ghost.dir.x;
    const nextY = ghost.y + ghost.dir.y;

    if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT || map[nextY][nextX] === 1 || Math.random() < 0.2) {
        ghost.dir = dirs[Math.floor(Math.random() * dirs.length)];
    } else {
        ghost.x = nextX;
        ghost.y = nextY;
    }
}

function checkGameState() {
    // Check for loss
    if (pacman.x === ghost.x && pacman.y === ghost.y) {
        gameStatus = 'lost';
        gameActive = false;
    }

    // Check for win: are there any pellets left?
    let pelletsLeft = false;
    for (let row = 0; row < GRID_HEIGHT; row++) {
        for (let col = 0; col < GRID_WIDTH; col++) {
            if (map[row][col] === 0) {
                pelletsLeft = true;
                break;
            }
        }
        if (pelletsLeft) break;
    }

    if (!pelletsLeft) {
        gameStatus = 'won';
        gameActive = false;
    }
}

let lastUpdate = 0;
function throttledLoop(timestamp) {
    if (!gameActive) {
        drawMap();
        drawPacman();
        drawGhost();

        ctx.fillStyle = gameStatus === 'won' ? 'lime' : 'red';
        ctx.font = '40px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(gameStatus === 'won' ? 'YOU WIN!' : 'GAME OVER', canvas.width/2, canvas.height/2);
        return;
    }

    if (timestamp - lastUpdate > 200) {
        updatePacman();
        updateGhost();
        checkGameState();
        lastUpdate = timestamp;
    }

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawMap();
    drawPacman();
    drawGhost();
    requestAnimationFrame(throttledLoop);
}

requestAnimationFrame(throttledLoop);
