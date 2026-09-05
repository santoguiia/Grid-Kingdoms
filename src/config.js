export const CONFIG = {
    // ==================== MAPA & CÂMERA ====================
    TILE_SIZE: 32,
    MAP_WIDTH: 80,
    MAP_HEIGHT: 80,
    CAMERA_SPEED: 4,
    ZOOM_MIN: 1.0,
    ZOOM_MAX: 2.0,
    ZOOM_STEP: 0.1,

    // ==================== VELOCIDADE GLOBAL ====================
    UNIT_SPEED_SCALE: 0.20,       // Multiplicador geral de velocidade das unidades

    // ==================== RECURSOS ====================
    STARTING_GOLD: 200,           // Ouro inicial do jogador
    STARTING_WOOD: 150,           // Madeira inicial do jogador
    STARTING_FOOD_USED: 3,        // Alimento em uso no início (3 camponeses)
    STARTING_FOOD_MAX: 5,         // Alimento máximo inicial

    GOLD_PER_MINE_TILE: 420,      // Quantidade de ouro disponível em cada tile de mina
    WOOD_PER_TREE_TILE: 40,       // Quantidade de madeira disponível em cada tile de árvore
    PEASANT_CARRY_CAPACITY: 8,    // Quantidade de recurso que o camponês carrega por viagem (padrão)
    GATHER_TIME: 400,             // Ticks de coleta antes de pegar recurso

    // ==================== CONSTRUÇÃO ====================
    BUILD_SPEED: 0.1,               // Progresso de construção por tick (quanto maior, mais rápido)

    // ==================== INÍCIO DO JOGO ====================
    STARTING_PEASANTS: 3,         // Número de camponeses iniciais por jogador

    // ==================== FOG OF WAR ====================
    UNIT_SIGHT_RANGE: 6,          // Raio de visão (em tiles) de unidades
    BUILDING_SIGHT_RANGE: 10,      // Raio de visão (em tiles) de edifícios

    // ==================== HERÓI ====================
    HERO_MAX_LEVEL: 5,            // Nível máximo do herói
    HERO_INITIAL_MAX_XP: 100,     // XP necessário para o primeiro nível
    HERO_XP_SCALE: 1.5,           // Multiplicador de XP necessário por nível (exponencial)
    HERO_LEVELUP_HP_BONUS: 80,    // Bônus de HP por nível
    HERO_LEVELUP_ATK_BONUS: 7,    // Bônus de ataque por nível
    HERO_LEVELUP_SIZE_BONUS: 1,   // Bônus de tamanho por nível
    HERO_MAX_SIZE: 15,            // Tamanho máximo do herói
    HERO_HEAL_BASE: 15,           // Cura base do herói (passiva/skill)
    HERO_HEAL_PER_LEVEL: 5,       // Cura adicional por nível do herói

    HERO_KILL_XP: 25,             // XP ganho ao matar unidade inimiga normal

    // ==================== TEMPO DE SPAWN / PRODUÇÃO DE UNIDADES (TICKS - 60 ticks = 1s) ====================
    SPAWN_TIME_PEASANT: 840,        // Camponês (14 segundos)
    SPAWN_TIME_SOLDIER: 1320,       // Soldado (22 segundos)
    SPAWN_TIME_ARCHER: 1020,        // Arqueiro (17 segundos)
    SPAWN_TIME_ORC_WARRIOR: 1960,   // Guerreiro Orc (32 segundos)
    SPAWN_TIME_ORC_SHAMAN: 1560,    // Xamã Orc (26 segundos)
    SPAWN_TIME_HERO_PALADIN: 2920,  // Paladino Herói (48 segundos)

    SPAWN_TIMES: {
        PEASANT: 840,
        SOLDIER: 1320,
        ARCHER: 1020,
        ORC_WARRIOR: 1960,
        ORC_SHAMAN: 1560,
        HERO_PALADIN: 2920,
    },

    // ==================== IDADES / ERAS ====================
    MAX_AGE: 3,                   // Número máximo de eras
    AGE_2_COST_GOLD: 250,         // Custo em ouro para Era 2
    AGE_2_COST_WOOD: 180,         // Custo em madeira para Era 2
    AGE_3_COST_GOLD: 450,         // Custo em ouro para Era 3
    AGE_3_COST_WOOD: 320,         // Custo em madeira para Era 3

    // ==================== IA & DIFICULDADE ====================
    AI_UPDATE_INTERVAL: 60,       // Intervalo de ticks entre atualizações da IA (~1 segundo para ações ágeis)
    BOT_DIFFICULTY: {
        EASY: {
            name: 'Fácil',
            gold: 200,
            wood: 150,
            gatherMultiplier: 1.0,
            bonusIncomeInterval: 0
        },
        MEDIUM: {
            name: 'Médio',
            gold: 450,
            wood: 300,
            gatherMultiplier: 1.25,
            bonusIncomeInterval: 120 // ouro/madeira extra periódico
        },
        HARD: {
            name: 'Difícil',
            gold: 900,
            wood: 600,
            gatherMultiplier: 1.5,
            bonusIncomeInterval: 60  // ouro/madeira extra periódico frequente
        }
    },

    // ==================== CORES DE FACÇÃO ====================
    FACTION_COLORS: {
        player: '#3b82f6', // Azul real
        bot1: '#ef4444',   // Vermelho
        bot2: '#10b981',   // Verde esmeralda
        bot3: '#a855f7',   // Roxo / Violeta
        p0: '#3b82f6',
        p1: '#ef4444',
        p2: '#10b981',
        p3: '#a855f7',
        enemy: '#ef4444'
    },
    TEAM_COLORS: {
        1: '#3b82f6', // Time 1 Azul
        2: '#ef4444', // Time 2 Vermelho
        3: '#10b981', // Time 3 Verde
        4: '#f59e0b'  // Time 4 Âmbar
    }
};

export const TERRAIN = { GRASS: 0, TREE: 1, WATER: 2, MOUNTAIN: 3, GOLD_MINE: 4, PATH: 5 };

window.CONFIG = CONFIG;
window.TERRAIN = TERRAIN;

