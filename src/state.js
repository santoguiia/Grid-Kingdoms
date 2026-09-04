export const gameState = {
    resources: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
    enemyResources: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
    factionResources: {
        player: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
        bot1: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
        bot2: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
        bot3: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
        p0: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
        p1: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
        p2: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 },
        p3: { gold: 200, wood: 150, foodUsed: 0, foodMax: 5 }
    },
    teams: {
        player: 1,
        bot1: 2,
        bot2: 3,
        bot3: 4,
        p0: 1,
        p1: 2,
        p2: 3,
        p3: 4
    },
    botConfigs: [], // [{ id: 'bot1', difficulty: 'MEDIUM', team: 2, hubIndex: 1 }]
    activeFactions: ['player'],
    units: [],
    buildings: [],
    projectiles: [],
    particles: [],
    selectedUnits: [],
    selectedBuilding: null,
    hoveredUnitId: null,
    hero: null,
    heroDead: false,
    heroLevel: 1,
    heroXP: 0,
    heroMaxXP: 100,
    camera: { x: 0, y: 0, zoom: 1 },
    keys: {},
    mouse: { x: 0, y: 0, worldX: 0, worldY: 0, down: false, rightDown: false, clickX: 0, clickY: 0 },
    dragStart: null,
    selectionBox: null,
    buildingMode: null,
    gameMode: 'single-player',
    aiDifficulty: 'MEDIUM', // 'EASY', 'MEDIUM', 'HARD'
    myRole: 'player', // 'player', 'p0', 'p1', 'p2', 'p3' ou 'enemy'
    age: 1,
    researchedTechs: [],
    activeResearch: null,
    rallyPoint: null,
    rallyMode: false,
    visibility: [],
    explored: [],
    resourceAmounts: [],
    resourceDiffs: [],
    gameOver: false,
    gameStarted: false,
    lastTime: 0,
    aiTimer: 0,
    map: [],
    aiStates: {}, // Armazena estado de cada bot por ID: { bot1: {...}, bot2: {...}, bot3: {...} }
    aiState: {
        knownPlayerBuildings: [],
        knownPlayerUnits: [],
        scoutUnitId: null,
        scoutWaypointIndex: 0,
        scoutWaypoints: [
            { x: 40, y: 30 }, // Centro
            { x: 20, y: 20 }, // Noroeste
            { x: 20, y: 45 }, // Sudoeste
            { x: 60, y: 15 }, // Nordeste
            { x: 40, y: 50 }, // Sul
            { x: 15, y: 35 }, // Oeste
        ],
        attackState: 'IDLE',
        attackTarget: null,
    },
    // ==================== MULTIPLAYER LOBBY STATES ====================
    currentMenuScreen: 'MAIN_MENU', // MAIN_MENU, MENU_MULTIPLAYER_SELECT, LOBBY_ROOM, GAME
    multiplayerLobby: {
        gameName: 'Reino dos Bravos #1',
        isHost: true,
        hostName: 'Jogador',
        mapData: null,
        gameSpeed: 'FAST', // SLOW, NORMAL, FAST
        gameVisibility: 'DEFAULT',
        slots: [], // [{ id: 0, type: 'PLAYER', name: 'Jogador', race: 'HUMAN', color: '#3b82f6', team: 1, handicap: '100%' }, ...]
        chatMessages: [] // [{ sender: 'Sistema', text: 'Bem-vindo ao Battle.net', color: '#ffd700' }]
    }
};
if (typeof window !== 'undefined') {
    window.gameState = gameState;
}

