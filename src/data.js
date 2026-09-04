import { CONFIG, TERRAIN } from './config.js';
import { gameState } from './state.js';
import { Unit, Building } from './entities.js';

const UNIT_DEFS = {
    PEASANT: {
        name: 'Camponês',
        health: 60,
        speed: 1.6,
        attack: 3,
        attackRange: 35,
        attackCooldown: 80,
        costGold: 50,
        costWood: 25,
        color: '#8b4513',
        size: 10,
        icon: '👨‍🌾',
        canGather: true,
        canAttack: true,
        gatherAmount: CONFIG.PEASANT_CARRY_CAPACITY,
        trainTime: CONFIG.SPAWN_TIME_PEASANT, // 14 segundos
    },
    SOLDIER: {
        name: 'Soldado',
        health: 150,
        speed: 1.6,
        attack: 16,
        attackRange: 30,
        attackCooldown: 65,
        costGold: 100,
        costWood: 50,
        color: '#4169e1',
        size: 13,
        icon: '⚔️',
        canAttack: true,
        trainTime: CONFIG.SPAWN_TIME_SOLDIER, // 22 segundos
    },
    ARCHER: {
        name: 'Arqueiro',
        health: 80,
        speed: 1.4,
        attack: 12,
        attackRange: 105,
        attackCooldown: 90,
        costGold: 75,
        costWood: 40,
        color: '#228b22',
        size: 12,
        icon: '🏹',
        canAttack: true,
        trainTime: CONFIG.SPAWN_TIME_ARCHER, // 17 segundos
    },
    ORC_WARRIOR: {
        name: 'Guerreiro Orc',
        health: 190,
        speed: 1.5,
        attack: 20,
        attackRange: 35,
        attackCooldown: 70,
        costGold: 130,
        costWood: 80,
        color: '#228b22',
        size: 14,
        icon: '👹',
        canAttack: true,
        trainTime: CONFIG.SPAWN_TIME_ORC_WARRIOR, // 32 segundos
    },
    ORC_SHAMAN: {
        name: 'Xamã Orc',
        health: 95,
        speed: 1.4,
        attack: 18,
        attackRange: 95,
        attackCooldown: 75,
        costGold: 90,
        costWood: 60,
        color: '#8b008b',
        size: 13,
        icon: '🧙',
        canAttack: true,
        trainTime: CONFIG.SPAWN_TIME_ORC_SHAMAN, // 26 segundos
    },
    // HERÓI
    HERO_PALADIN: {
        name: 'Paladino (Herói)',
        health: 450,
        speed: 1.5,
        attack: 28,
        attackRange: 40,
        attackCooldown: 60,
        costGold: 200,
        costWood: 100,
        color: '#f59e0b',
        size: 20,
        icon: '👑',
        canAttack: true,
        isHero: true,
        trainTime: CONFIG.SPAWN_TIME_HERO_PALADIN, // 48 segundos
    },
    // MOBS NEUTROS (CREEPS)
    CREEP_WOLF: {
        name: 'Lobo Selvagem',
        health: 75,
        speed: 1.5,
        attack: 8,
        attackRange: 25,
        attackCooldown: 65,
        color: '#71717a',
        size: 12,
        icon: '🐺',
        canAttack: true,
        xpReward: 35,
        goldReward: 15,
    },
    CREEP_OGRE: {
        name: 'Ogro Guerreiro',
        health: 175,
        speed: 1.2,
        attack: 16,
        attackRange: 30,
        attackCooldown: 75,
        color: '#84cc16',
        size: 15,
        icon: '🧌',
        canAttack: true,
        xpReward: 75,
        goldReward: 35,
    },
    CREEP_GOLEM: {
        name: 'Golem de Pedra (Chefe)',
        health: 350,
        speed: 1.0,
        attack: 26,
        attackRange: 35,
        attackCooldown: 85,
        color: '#78716c',
        size: 18,
        icon: '🗿',
        canAttack: true,
        xpReward: 160,
        goldReward: 75,
    },
};

if (typeof window !== 'undefined') {
    window.UNIT_DEFS = UNIT_DEFS;
}

const BUILDING_DEFS = {
    TOWN_HALL: {
        health: 1000, width: 3, height: 3,
        color: '#8b4513', icon: '🏰',
        name: 'Town Hall', costGold: 200, costWood: 150,
        buildTime: 300, trains: ['PEASANT'],
    },
    HOUSE: {
        health: 300, width: 2, height: 2,
        color: '#a0522d', icon: '🏠',
        name: 'Casa', costGold: 100, costWood: 50,
        buildTime: 180, providesFood: true, foodAmount: 8,
        trains: ['PEASANT'],
    },
    BARRACKS: {
        health: 500, width: 2, height: 2,
        color: '#696969', icon: '🏛️',
        name: 'Quartel', costGold: 150, costWood: 100,
        buildTime: 240, trains: ['SOLDIER'],
    },
    ARCHERY_RANGE: {
        health: 400, width: 2, height: 2,
        color: '#8b6914', icon: '🎯',
        name: 'Arco e Flecha', costGold: 125, costWood: 75,
        buildTime: 210, trains: ['ARCHER'],
    },
    FARM: {
        health: 200, width: 2, height: 2,
        color: '#deb887', icon: '🌾',
        name: 'Fazenda', costGold: 50, costWood: 25,
        buildTime: 150, providesFood: true, foodAmount: 4,
    },
    TOWER: {
        health: 220, width: 1, height: 1,
        color: '#708090', icon: '🗼',
        name: 'Torre', costGold: 150, costWood: 50,
        buildTime: 400, canAttack: true, attack: 15, attackRange: 120, attackCooldown: 60,
    },
    BLACKSMITH: {
        health: 450, width: 2, height: 2,
        color: '#4b5563', icon: '⚒️',
        name: 'Forja', costGold: 180, costWood: 120, buildTime: 240,
        requiredAge: 2
    },
    MARKET: {
        health: 350, width: 2, height: 2,
        color: '#9a6b3f', icon: '🏪',
        name: 'Mercado', costGold: 140, costWood: 100, buildTime: 210,
        requiredAge: 2
    },
    CASTLE: {
        health: 900, width: 3, height: 3,
        color: '#374151', icon: '🏯',
        name: 'Castelo', costGold: 350, costWood: 250, buildTime: 420,
        requiredAge: 3
    },
    ALTAR: {
        health: 650, width: 2, height: 2,
        color: '#d97706', icon: '⛩️',
        name: 'Altar dos Reis', costGold: 180, costWood: 100, buildTime: 260,
        trains: ['HERO_PALADIN']
    },
};

const TECHNOLOGY_DEFS = {
    LOOM: {
        name: 'Lã e Couro',
        icon: '🧵',
        costGold: 120,
        costWood: 60,
        researchTime: 180,
        description: '+25% de vida para todos os camponeses.',
        apply: () => {
            for (const unit of gameState.units) {
                if (unit.canGather && unit.owner === 'player') {
                    unit.maxHealth = Math.round(unit.maxHealth * 1.25);
                    unit.health = Math.min(unit.maxHealth, Math.round(unit.health * 1.25));
                }
            }
        }
    },
    LUMBER_MILL: {
        name: 'Serraria',
        icon: '📐',
        costGold: 150,
        costWood: 100,
        researchTime: 240,
        description: '+15% de eficiência na coleta de madeira.',
        apply: () => {
            for (const unit of gameState.units) {
                if (unit.canGather && unit.owner === 'player') unit.gatherRate *= 1.15;
            }
        }
    },
    WHEELBARROW: {
        name: 'Carrinho de Mão',
        icon: '🛒',
        costGold: 180,
        costWood: 100,
        researchTime: 240,
        description: '+50% de capacidade e coleta mais eficiente.',
        apply: () => {
            for (const unit of gameState.units) {
                if (unit.canGather && unit.owner === 'player') unit.maxGather = Math.ceil(unit.maxGather * 1.5);
            }
        }
    },
    IRON_WORKING: {
        name: 'Metalurgia',
        icon: '⚔️',
        costGold: 220,
        costWood: 140,
        researchTime: 300,
        description: '+15% de ataque para soldados e arqueiros.',
        apply: () => {
            for (const unit of gameState.units) {
                if (unit.owner === 'player' && unit.canAttack && !unit.canGather) unit.attack = Math.ceil(unit.attack * 1.15);
            }
        }
    }
};

// ============================================================
// GERAÇÃO DE MAPA QUADRADO (80x80) COM SPAWNS EM MÁXIMA DISTÂNCIA
// ============================================================
const CORNER_HUBS = [
    {
        name: 'NW',
        base: { x: 14, y: 14 },
        goldMine: { x: 8, y: 8 },
        forests: [{ x: 21, y: 8, count: 14 }, { x: 8, y: 21, count: 14 }],
        clearArea: { minX: 8, maxX: 21, minY: 8, maxY: 21 }
    },
    {
        name: 'SE',
        base: { x: 63, y: 63 },
        goldMine: { x: 69, y: 69 },
        forests: [{ x: 56, y: 69, count: 14 }, { x: 69, y: 56, count: 14 }],
        clearArea: { minX: 56, maxX: 69, minY: 56, maxY: 69 }
    },
    {
        name: 'NE',
        base: { x: 63, y: 14 },
        goldMine: { x: 69, y: 8 },
        forests: [{ x: 56, y: 8, count: 14 }, { x: 69, y: 21, count: 14 }],
        clearArea: { minX: 56, maxX: 69, minY: 8, maxY: 21 }
    },
    {
        name: 'SW',
        base: { x: 14, y: 63 },
        goldMine: { x: 8, y: 69 },
        forests: [{ x: 21, y: 69, count: 14 }, { x: 8, y: 56, count: 14 }],
        clearArea: { minX: 8, maxX: 21, minY: 56, maxY: 69 }
    }
];

const ALL_EXPANSION_HUBS = [
    ...CORNER_HUBS,
    {
        name: 'Center',
        base: { x: 34, y: 34 },
        goldMine: { x: 40, y: 40 },
        forests: [{ x: 40, y: 28, count: 12 }, { x: 40, y: 52, count: 12 }],
        clearArea: { minX: 32, maxX: 48, minY: 32, maxY: 48 }
    }
];

function generateMap(mapIndex = 0, seed = Math.random()) {
    gameState.map = [];
    let randomSeed = Math.floor(seed * 2147483647) || 1;
    const random = () => {
        randomSeed = (randomSeed * 48271) % 2147483647;
        return randomSeed / 2147483647;
    };

    // 1. Inicializar terreno com ruído suave para lagos e bosques naturais
    for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) {
        gameState.map[y] = [];
        for (let x = 0; x < CONFIG.MAP_WIDTH; x++) {
            // Bordas montanhosas para delimitar o mapa quadrado
            if (x < 4 || x >= CONFIG.MAP_WIDTH - 4 || y < 4 || y >= CONFIG.MAP_HEIGHT - 4) {
                gameState.map[y][x] = TERRAIN.MOUNTAIN;
            } else {
                let noise;
                if (mapIndex === 2) {
                    // Deserto: grandes dunas suaves e dunas menores sobrepostas
                    noise = Math.sin(x * 0.08) * Math.sin(y * 0.08) + Math.cos(x * 0.04 + y * 0.04) * 0.3;
                } else if (mapIndex === 1) {
                    noise = Math.sin(x * 0.09 + y * 0.03) * 0.8 + Math.cos(y * 0.16) * 0.45;
                } else {
                    noise = Math.sin(x * 0.14) * Math.cos(y * 0.14) +
                        Math.sin(x * 0.07 + y * 0.07) * 0.5;
                }

                if (mapIndex === 2) {
                    // No deserto, água apenas em oásis raros e contidos, NUNCA perto das bases/spawns
                    const nearAnyHub = ALL_EXPANSION_HUBS.some(h => Math.hypot(x - h.base.x, y - h.base.y) < 18);
                    if (noise < -0.92 && !nearAnyHub) {
                        gameState.map[y][x] = TERRAIN.WATER;
                    } else if (noise > 0.35) {
                        // Cactos esparsos nas dunas
                        gameState.map[y][x] = random() < 0.18 ? TERRAIN.TREE : TERRAIN.GRASS;
                    } else {
                        gameState.map[y][x] = TERRAIN.GRASS;
                    }
                } else {
                    if (noise < -0.65) {
                        gameState.map[y][x] = TERRAIN.WATER;
                    } else if (noise < -0.35) {
                        gameState.map[y][x] = random() < (mapIndex === 1 ? 0.55 : 0.35) ? TERRAIN.TREE : TERRAIN.GRASS;
                    } else {
                        gameState.map[y][x] = TERRAIN.GRASS;
                    }
                }
            }
        }
    }

    // 2. O spawn é sorteado; o índice seleciona apenas o tipo de terreno.
    const pairs = [
        { player: 0, enemy: 1 }, // NW vs SE
        { player: 1, enemy: 0 }, // SE vs NW
        { player: 2, enemy: 3 }, // NE vs SW
        { player: 3, enemy: 2 }, // SW vs NE
    ];

    const chosenIndex = Math.floor(random() * pairs.length);
    const chosenPair = pairs[chosenIndex];

    const playerHub = CORNER_HUBS[chosenPair.player];
    const enemyHub = CORNER_HUBS[chosenPair.enemy];

    // 3. Limpar áreas de todos os hubs de expansão/spawns (incluindo centro)
    for (const hub of ALL_EXPANSION_HUBS) {
        for (let cy = hub.clearArea.minY; cy <= hub.clearArea.maxY; cy++) {
            for (let cx = hub.clearArea.minX; cx <= hub.clearArea.maxX; cx++) {
                if (cy >= 4 && cy < CONFIG.MAP_HEIGHT - 4 && cx >= 4 && cx < CONFIG.MAP_WIDTH - 4) {
                    gameState.map[cy][cx] = TERRAIN.GRASS;
                }
            }
        }
    }

    // 4. Inserir minas de ouro 3x3 em cada um dos 4 cantos + 1 no centro disputado
    const goldMines = [
        hubMine(CORNER_HUBS[0].goldMine),
        hubMine(CORNER_HUBS[1].goldMine),
        hubMine(CORNER_HUBS[2].goldMine),
        hubMine(CORNER_HUBS[3].goldMine),
        { x: 40, y: 40 }, // Mina central disputada
    ];

    function hubMine(pos) {
        return { x: pos.x, y: pos.y };
    }

    for (const mine of goldMines) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = mine.x + dx;
                const ny = mine.y + dy;
                if (nx >= 0 && nx < CONFIG.MAP_WIDTH && ny >= 0 && ny < CONFIG.MAP_HEIGHT) {
                    gameState.map[ny][nx] = TERRAIN.GOLD_MINE;
                }
            }
        }
    }

    // 5. Inserir florestas ricas perto dos cantos e no meio do mapa
    const allForests = [];
    for (const hub of CORNER_HUBS) {
        allForests.push(...hub.forests);
    }
    // Florestas intermediárias
    allForests.push(
        { x: 40, y: 22, count: 18 },
        { x: 40, y: 58, count: 18 },
        { x: 22, y: 40, count: 18 },
        { x: 58, y: 40, count: 18 }
    );

    for (const forest of allForests) {
        for (let i = 0; i < forest.count; i++) {
            const fx = forest.x + Math.floor(random() * 8) - 4;
            const fy = forest.y + Math.floor(random() * 8) - 4;
            if (fx >= 4 && fx < CONFIG.MAP_WIDTH - 4 && fy >= 4 && fy < CONFIG.MAP_HEIGHT - 4) {
                if (gameState.map[fy][fx] === TERRAIN.GRASS) {
                    gameState.map[fy][fx] = TERRAIN.TREE;
                }
            }
        }
    }

    // 6. Garantir que a área do Town Hall e entorno imediato esteja livre
    for (const hub of CORNER_HUBS) {
        for (let dy = -2; dy <= 4; dy++) {
            for (let dx = -2; dx <= 4; dx++) {
                const tx = hub.base.x + dx;
                const ty = hub.base.y + dy;
                if (tx >= 0 && tx < CONFIG.MAP_WIDTH && ty >= 0 && ty < CONFIG.MAP_HEIGHT) {
                    if (gameState.map[ty][tx] !== TERRAIN.GOLD_MINE) {
                        gameState.map[ty][tx] = TERRAIN.GRASS;
                    }
                }
            }
        }
    }

    // 7. Criar caminhos de terra estratégicos conectando os cantos ao centro
    createPath(14, 14, 40, 40);
    createPath(63, 63, 40, 40);
    createPath(63, 14, 40, 40);
    createPath(14, 63, 40, 40);

    // Caminhos de borda
    createPath(14, 14, 63, 14);
    createPath(63, 14, 63, 63);
    createPath(63, 63, 14, 63);
    createPath(14, 63, 14, 14);

    const spawnInfo = {
        player: { x: playerHub.base.x, y: playerHub.base.y, name: playerHub.name },
        enemy: { x: enemyHub.base.x, y: enemyHub.base.y, name: enemyHub.name },
        corners: CORNER_HUBS.map(h => ({ x: h.base.x, y: h.base.y, name: h.name })),
        pairIndex: chosenIndex
    };

    gameState.spawnInfo = spawnInfo;
    return spawnInfo;
}

function createPath(x1, y1, x2, y2) {
    let x = x1, y = y1;
    while (x !== x2 || y !== y2) {
        if (Math.abs(x - x2) > Math.abs(y - y2)) {
            x += x < x2 ? 1 : -1;
        } else {
            y += y < y2 ? 1 : -1;
        }
        if (x >= 0 && x < CONFIG.MAP_WIDTH && y >= 0 && y < CONFIG.MAP_HEIGHT) {
            // Se for grama ou água, cria caminho de terra transitável (ponte de terra firme)
            if (gameState.map[y][x] === TERRAIN.GRASS || gameState.map[y][x] === TERRAIN.WATER) {
                gameState.map[y][x] = TERRAIN.PATH;
            }
            // Abrir largura mínima de 2 tiles para passagem confortável do exército
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 4 && nx < CONFIG.MAP_WIDTH - 4 && ny >= 4 && ny < CONFIG.MAP_HEIGHT - 4) {
                        if (gameState.map[ny][nx] === TERRAIN.WATER) {
                            gameState.map[ny][nx] = TERRAIN.PATH;
                        }
                    }
                }
            }
        }
    }
}

// ============================================================

export { UNIT_DEFS, BUILDING_DEFS, TECHNOLOGY_DEFS, CORNER_HUBS, ALL_EXPANSION_HUBS, generateMap, createPath };
