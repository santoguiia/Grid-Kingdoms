import { CONFIG, TERRAIN } from './config.js';
import { gameState } from './state.js';
import {
    Unit,
    Building,
    getEntityPosition,
    resolveUnitCollisions,
    isCollidingWithObstacle,
    getStandPositionNearBuilding,
    assignFormationPositions,
    isEntityHostile
} from './entities.js';
import { UNIT_DEFS, BUILDING_DEFS, TECHNOLOGY_DEFS, ALL_EXPANSION_HUBS, generateMap } from './data.js';

import { showToast } from './ui.js';
import { networkTick } from './network.js';

function initGame(mapIndex = 0, seed = Math.random(), customConfig = null) {
    gameState.mapIndex = mapIndex;
    const customMapData = customConfig?.mapData || (typeof mapIndex === 'object' ? mapIndex : null);
    const spawnInfo = generateMap(typeof mapIndex === 'number' ? mapIndex : 0, seed, customMapData);
    gameState.resourceAmounts = gameState.map.map(row => row.map(terrain =>
        terrain === TERRAIN.GOLD_MINE ? CONFIG.GOLD_PER_MINE_TILE : terrain === TERRAIN.TREE ? CONFIG.WOOD_PER_TREE_TILE : 0
    ));
    gameState.visibility = Array.from({ length: CONFIG.MAP_HEIGHT }, () => Array(CONFIG.MAP_WIDTH).fill(false));
    gameState.explored = Array.from({ length: CONFIG.MAP_HEIGHT }, () => Array(CONFIG.MAP_WIDTH).fill(false));
    gameState.units = [];
    gameState.buildings = [];
    gameState.projectiles = [];
    gameState.particles = [];
    gameState.resourceDiffs = [];

    // Faction Setup: single-player com bots ou multiplayer
    const isMultiplayer = gameState.gameMode === 'multiplayer';
    const lobbySlots = customConfig?.slots || (isMultiplayer && gameState.multiplayerLobby?.slots ? gameState.multiplayerLobby.slots : null);

    // 2. Spawn das Facções nos cantos do mapa (CORNER_HUBS: NW, SE, NE, SW)
    const cornerHubs = spawnInfo.corners || [
        { x: 14, y: 14, name: 'NW' },
        { x: 63, y: 63, name: 'SE' },
        { x: 63, y: 14, name: 'NE' },
        { x: 14, y: 63, name: 'SW' },
    ];

    // Inicializar estruturas
    gameState.teams = {};
    gameState.botConfigs = [];
    gameState.activeFactions = ['player'];
    if (!gameState.factionResources) gameState.factionResources = {};
    gameState.aiStates = {};

    // 1. Configurar Facções, Cores e Times
    if (isMultiplayer && lobbySlots && lobbySlots.length > 0) {
        // Modo Multiplayer configurado via Lobby (com suporte a Jogadores humanos e Computador IA)
        const slot0 = lobbySlots[0] || { team: 1, color: '#3b82f6' };
        const playerTeam = slot0.team || 1;
        gameState.teams['player'] = playerTeam;
        gameState.teams['p0'] = playerTeam;

        if (slot0.color) {
            CONFIG.FACTION_COLORS['player'] = slot0.color;
            CONFIG.FACTION_COLORS['p0'] = slot0.color;
        }

        for (let i = 1; i < lobbySlots.length; i++) {
            const slot = lobbySlots[i];
            if (!slot || slot.type === 'CLOSED' || slot.type === 'OPEN') continue;

            const slotTeam = slot.team || (slot.id + 1);
            if (slot.type === 'PLAYER') {
                gameState.teams['enemy'] = slotTeam;
                gameState.teams['p' + slot.id] = slotTeam;
                if (!gameState.activeFactions.includes('enemy')) gameState.activeFactions.push('enemy');
                if (slot.color) {
                    CONFIG.FACTION_COLORS['enemy'] = slot.color;
                    CONFIG.FACTION_COLORS['p' + slot.id] = slot.color;
                }
            } else if (slot.type === 'COMPUTER') {
                const botId = 'bot' + slot.id;
                gameState.teams[botId] = slotTeam;
                if (!gameState.activeFactions.includes(botId)) gameState.activeFactions.push(botId);
                if (slot.color) {
                    CONFIG.FACTION_COLORS[botId] = slot.color;
                    CONFIG.FACTION_COLORS['p' + slot.id] = slot.color;
                }

                const diffKey = slot.difficulty || 'MEDIUM';
                gameState.botConfigs.push({
                    id: botId,
                    difficulty: diffKey,
                    team: slotTeam,
                    race: slot.race || 'ORC',
                    color: slot.color,
                    hubIndex: slot.id % cornerHubs.length
                });
            }
        }
    } else if (isMultiplayer) {
        // Modo Multiplayer clássico 1v1
        gameState.activeFactions = ['player', 'enemy'];
        gameState.teams = { player: 1, p0: 1, enemy: 2, p1: 2, p2: 3, p3: 4 };
        gameState.botConfigs = [];
    } else {
        // Modo Single-Player configurável
        const playerTeam = customConfig?.playerTeam || 1;
        const diffKey = gameState.aiDifficulty || 'MEDIUM';
        const bots = customConfig?.bots || [
            { id: 'bot1', difficulty: diffKey, team: playerTeam === 1 ? 2 : 1 }
        ];

        gameState.teams = { player: playerTeam, p0: playerTeam };
        gameState.botConfigs = bots;
        gameState.activeFactions = ['player', ...bots.map(b => b.id)];

        bots.forEach(b => {
            gameState.teams[b.id] = b.team || 2;
        });
    }

    // Player Hub (sempre corner 0)
    const playerHub = cornerHubs[0];
    const playerBase = new Building(BUILDING_DEFS.TOWN_HALL, playerHub.x, playerHub.y, 'player', true, 'base_player_0');
    gameState.buildings.push(playerBase);

    for (let i = 0; i < CONFIG.STARTING_PEASANTS; i++) {
        const px = (playerHub.x + 3.5) * CONFIG.TILE_SIZE + (i - 1) * 18;
        const py = (playerHub.y + 3.5) * CONFIG.TILE_SIZE + 10;
        const pUnit = new Unit(UNIT_DEFS.PEASANT, px, py, 'player', `peasant_player_${i}`);
        gameState.units.push(pUnit);
    }

    // Inicializar recursos da facção do jogador
    gameState.resources = {
        gold: CONFIG.STARTING_GOLD,
        wood: CONFIG.STARTING_WOOD,
        foodUsed: CONFIG.STARTING_FOOD_USED,
        foodMax: CONFIG.STARTING_FOOD_MAX
    };
    gameState.factionResources['player'] = gameState.resources;

    if (isMultiplayer && lobbySlots && lobbySlots.length > 0) {
        // Spawns dos slots do Lobby (adversários humanos e bots)
        for (let i = 1; i < lobbySlots.length; i++) {
            const slot = lobbySlots[i];
            if (!slot || slot.type === 'CLOSED' || slot.type === 'OPEN') continue;

            const hubIndex = slot.id % cornerHubs.length;
            const hub = cornerHubs[hubIndex];

            if (slot.type === 'PLAYER') {
                const enemyBase = new Building(BUILDING_DEFS.TOWN_HALL, hub.x, hub.y, 'enemy', true, 'base_enemy_0');
                gameState.buildings.push(enemyBase);

                for (let j = 0; j < CONFIG.STARTING_PEASANTS; j++) {
                    const ex = (hub.x + 3.5) * CONFIG.TILE_SIZE + (j - 1) * 18;
                    const ey = (hub.y + 3.5) * CONFIG.TILE_SIZE + 10;
                    const peon = new Unit(UNIT_DEFS.PEASANT, ex, ey, 'enemy', `peasant_enemy_${j}`);
                    gameState.units.push(peon);
                }

                gameState.enemyResources = {
                    gold: CONFIG.STARTING_GOLD,
                    wood: CONFIG.STARTING_WOOD,
                    foodUsed: CONFIG.STARTING_FOOD_USED,
                    foodMax: CONFIG.STARTING_FOOD_MAX
                };
                gameState.factionResources['enemy'] = gameState.enemyResources;
            } else if (slot.type === 'COMPUTER') {
                const botOwner = 'bot' + slot.id;
                const botBase = new Building(BUILDING_DEFS.TOWN_HALL, hub.x, hub.y, botOwner, true, `base_${botOwner}_0`);
                gameState.buildings.push(botBase);

                for (let j = 0; j < CONFIG.STARTING_PEASANTS; j++) {
                    const bx = (hub.x + 3.5) * CONFIG.TILE_SIZE + (j - 1) * 18;
                    const by = (hub.y + 3.5) * CONFIG.TILE_SIZE + 10;
                    const peon = new Unit(UNIT_DEFS.PEASANT, bx, by, botOwner, `peasant_${botOwner}_${j}`);
                    peon.autoGathering = true;
                    peon.findResource(j < 2 ? 'gold' : 'wood');
                    gameState.units.push(peon);
                }

                const diffKey = slot.difficulty || 'MEDIUM';
                const diffConfig = CONFIG.BOT_DIFFICULTY?.[diffKey] || CONFIG.BOT_DIFFICULTY?.MEDIUM || { gold: 200, wood: 150 };

                const botResources = {
                    gold: diffConfig.gold,
                    wood: diffConfig.wood,
                    foodUsed: CONFIG.STARTING_FOOD_USED,
                    foodMax: CONFIG.STARTING_FOOD_MAX,
                    difficulty: diffKey,
                    bonusInterval: diffConfig.bonusIncomeInterval || 0
                };
                gameState.factionResources[botOwner] = botResources;

                if (slot.id === 1 && !lobbySlots.some(s => s.id !== 1 && s.type === 'PLAYER')) {
                    gameState.enemyResources = botResources;
                }

                const otherCorners = cornerHubs.filter((_, idx) => idx !== hubIndex);
                const availableHubs = ALL_EXPANSION_HUBS.filter(h => !(h.base.x === hub.x && h.base.y === hub.y));

                gameState.aiStates[botOwner] = {
                    botId: botOwner,
                    team: slot.team || (slot.id + 1),
                    difficulty: diffKey,
                    knownPlayerBuildings: [],
                    knownPlayerUnits: [],
                    scoutUnitId: null,
                    scoutWaypointIndex: 0,
                    scoutWaypoints: [
                        { x: 40, y: 40 },
                        ...otherCorners,
                        { x: 40, y: 20 },
                        { x: 40, y: 60 },
                        { x: 20, y: 40 },
                        { x: 60, y: 40 },
                    ],
                    attackState: 'IDLE',
                    attackTarget: null,
                    candidateHubs: availableHubs,
                    expansionCooldown: 180,
                    lastAttackTimer: 0,
                };
            }
        }

        if (gameState.botConfigs.length > 0) {
            gameState.aiState = gameState.aiStates[gameState.botConfigs[0].id];
        }
    } else if (isMultiplayer) {
        // Multiplayer legado 1v1
        const enemyHub = cornerHubs[1] || spawnInfo.enemy;
        const enemyBase = new Building(BUILDING_DEFS.TOWN_HALL, enemyHub.x, enemyHub.y, 'enemy', true, 'base_enemy_0');
        gameState.buildings.push(enemyBase);

        for (let i = 0; i < CONFIG.STARTING_PEASANTS; i++) {
            const ex = (enemyHub.x + 3.5) * CONFIG.TILE_SIZE + (i - 1) * 18;
            const ey = (enemyHub.y + 3.5) * CONFIG.TILE_SIZE + 10;
            const peon = new Unit(UNIT_DEFS.PEASANT, ex, ey, 'enemy', `peasant_enemy_${i}`);
            gameState.units.push(peon);
        }

        gameState.enemyResources = {
            gold: CONFIG.STARTING_GOLD,
            wood: CONFIG.STARTING_WOOD,
            foodUsed: CONFIG.STARTING_FOOD_USED,
            foodMax: CONFIG.STARTING_FOOD_MAX
        };
        gameState.factionResources['enemy'] = gameState.enemyResources;
    } else {
        // Single-player: Criar cada bot ativo no seu respectivo corner
        const bots = gameState.botConfigs;
        bots.forEach((bot, index) => {
            const hubIndex = (index + 1) % cornerHubs.length;
            const botHub = cornerHubs[hubIndex];
            const botOwner = bot.id; // 'bot1', 'bot2', 'bot3'

            const botBase = new Building(BUILDING_DEFS.TOWN_HALL, botHub.x, botHub.y, botOwner, true, `base_${botOwner}_0`);
            gameState.buildings.push(botBase);

            for (let i = 0; i < CONFIG.STARTING_PEASANTS; i++) {
                const bx = (botHub.x + 3.5) * CONFIG.TILE_SIZE + (i - 1) * 18;
                const by = (botHub.y + 3.5) * CONFIG.TILE_SIZE + 10;
                const peon = new Unit(UNIT_DEFS.PEASANT, bx, by, botOwner, `peasant_${botOwner}_${i}`);
                peon.autoGathering = true;
                peon.findResource(i < 2 ? 'gold' : 'wood');
                gameState.units.push(peon);
            }

            // Dificuldade define ouro e madeira iniciais do bot
            const diffKey = bot.difficulty || gameState.aiDifficulty || 'MEDIUM';
            const diffConfig = CONFIG.BOT_DIFFICULTY?.[diffKey] || CONFIG.BOT_DIFFICULTY?.MEDIUM || { gold: 200, wood: 150 };

            const botResources = {
                gold: diffConfig.gold,
                wood: diffConfig.wood,
                foodUsed: CONFIG.STARTING_FOOD_USED,
                foodMax: CONFIG.STARTING_FOOD_MAX,
                difficulty: diffKey,
                bonusInterval: diffConfig.bonusIncomeInterval || 0
            };

            gameState.factionResources[botOwner] = botResources;

            // Se for bot1, manter sincronizado com gameState.enemyResources para compatibilidade
            if (botOwner === 'bot1') {
                gameState.enemyResources = botResources;
            }

            // Waypoints e estado de IA para cada bot
            const otherCorners = cornerHubs.filter((_, idx) => idx !== hubIndex);
            const availableHubs = ALL_EXPANSION_HUBS.filter(h => !(h.base.x === botHub.x && h.base.y === botHub.y));

            gameState.aiStates[botOwner] = {
                botId: botOwner,
                team: bot.team || 2,
                difficulty: diffKey,
                knownPlayerBuildings: [],
                knownPlayerUnits: [],
                scoutUnitId: null,
                scoutWaypointIndex: 0,
                scoutWaypoints: [
                    { x: 40, y: 40 },
                    ...otherCorners,
                    { x: 40, y: 20 },
                    { x: 40, y: 60 },
                    { x: 20, y: 40 },
                    { x: 60, y: 40 },
                ],
                attackState: 'IDLE',
                attackTarget: null,
                candidateHubs: availableHubs,
                expansionCooldown: 180,
                lastAttackTimer: 0,
            };
        });

        // Configurar aiState default para bot1
        if (gameState.aiStates['bot1']) {
            gameState.aiState = gameState.aiStates['bot1'];
        }
    }

    // Spawns de Mobs Neutros (Creeps)
    spawnCreepCamps();

    gameState.hero = null;
    gameState.heroDead = false;
    gameState.heroLevel = 1;
    gameState.heroXP = 0;
    gameState.heroMaxXP = CONFIG.HERO_INITIAL_MAX_XP;
    gameState.age = 1;
    gameState.researchedTechs = [];
    gameState.activeResearch = null;
    gameState.rallyPoint = null;
    gameState.rallyMode = false;
    gameState.selectedUnits = [];
    gameState.selectedBuilding = null;

    // Centralizar câmera na base do jogador local
    const myHub = (gameState.myRole === 'enemy' || gameState.myRole === 'p1') ? cornerHubs[1] : cornerHubs[0];
    gameState.camera.x = (myHub.x + 1.5) * CONFIG.TILE_SIZE;
    gameState.camera.y = (myHub.y + 1.5) * CONFIG.TILE_SIZE;
    gameState.camera.zoom = 0.8;
    gameState.gameOver = false;
    gameState.aiTimer = 0;

    updateFogOfWar();
    if (!isMultiplayer || (gameState.botConfigs && gameState.botConfigs.length > 0)) updateEnemyVision();
}


function spawnCreepCamps() {
    // Se o mapa customizado definiu acampamentos de creeps próprios
    if (gameState.customCreeps && Array.isArray(gameState.customCreeps) && gameState.customCreeps.length > 0) {
        for (const camp of gameState.customCreeps) {
            const defType = UNIT_DEFS[camp.type] || UNIT_DEFS.CREEP_WOLF;
            const count = camp.count || 1;
            for (let i = 0; i < count; i++) {
                const offset = (i - (count - 1) / 2) * 16;
                const cx = (camp.x * CONFIG.TILE_SIZE) + offset;
                const cy = (camp.y * CONFIG.TILE_SIZE);
                const creep = new Unit(defType, cx, cy, 'neutral');
                gameState.units.push(creep);
            }
        }
        return;
    }

    // Acampamentos em pontos estratégicos (intermediários e centro)
    const camps = [
        // Campos perto das rotas intermediárias (Lobos)
        { x: 26, y: 26, type: UNIT_DEFS.CREEP_WOLF, count: 2 },
        { x: 54, y: 26, type: UNIT_DEFS.CREEP_WOLF, count: 2 },
        { x: 26, y: 54, type: UNIT_DEFS.CREEP_WOLF, count: 2 },
        { x: 54, y: 54, type: UNIT_DEFS.CREEP_WOLF, count: 2 },
        // Guardiões de recursos intermediários (Ogros)
        { x: 40, y: 24, type: UNIT_DEFS.CREEP_OGRE, count: 1 },
        { x: 40, y: 56, type: UNIT_DEFS.CREEP_OGRE, count: 1 },
        { x: 24, y: 40, type: UNIT_DEFS.CREEP_OGRE, count: 1 },
        { x: 56, y: 40, type: UNIT_DEFS.CREEP_OGRE, count: 1 },
        // Chefe do centro do mapa (Golem de Pedra)
        { x: 40, y: 40, type: UNIT_DEFS.CREEP_GOLEM, count: 1 },
    ];

    for (const camp of camps) {
        for (let i = 0; i < camp.count; i++) {
            const offset = (i - (camp.count - 1) / 2) * 16;
            const cx = (camp.x * CONFIG.TILE_SIZE) + offset;
            const cy = (camp.y * CONFIG.TILE_SIZE);
            const creep = new Unit(camp.type, cx, cy, 'neutral');
            gameState.units.push(creep);
        }
    }
}

export function addHeroXP(amount) {
    if (!gameState.hero || gameState.hero.health <= 0) return;
    gameState.heroXP = (gameState.heroXP || 0) + amount;

    // Nível máximo = 5
    if (gameState.heroLevel >= CONFIG.HERO_MAX_LEVEL) {
        gameState.heroXP = gameState.heroMaxXP;
        return;
    }

    if (gameState.heroXP >= gameState.heroMaxXP) {
        gameState.heroXP -= gameState.heroMaxXP;
        gameState.heroLevel = (gameState.heroLevel || 1) + 1;
        gameState.heroMaxXP = Math.round(gameState.heroMaxXP * CONFIG.HERO_XP_SCALE);

        // Bônus de atributos do Herói
        const hero = gameState.hero;
        hero.maxHealth += CONFIG.HERO_LEVELUP_HP_BONUS;
        hero.health = hero.maxHealth; // Cura total no Level Up
        hero.attack += CONFIG.HERO_LEVELUP_ATK_BONUS;
        hero.size = Math.min(CONFIG.HERO_MAX_SIZE, hero.size + CONFIG.HERO_LEVELUP_SIZE_BONUS);

        // Efeito visual comemorativo de Level Up
        showToast(`⭐ LEVEL UP! Seu Paladino atingiu o Nível ${gameState.heroLevel}!`);
        for (let i = 0; i < 20; i++) {
            gameState.particles.push({
                x: hero.x + (Math.random() - 0.5) * 20,
                y: hero.y + (Math.random() - 0.5) * 20,
                vx: (Math.random() - 0.5) * 4,
                vy: -Math.random() * 4 - 1,
                life: 35,
                maxLife: 35,
                color: '#facc15',
                size: 3.5
            });
        }
    }
}

function updateFogOfWar() {
    for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) gameState.visibility[y].fill(false);
    const reveal = (worldX, worldY, radius) => {
        const centerX = Math.floor(worldX / CONFIG.TILE_SIZE);
        const centerY = Math.floor(worldY / CONFIG.TILE_SIZE);
        for (let y = Math.max(0, centerY - radius); y <= Math.min(CONFIG.MAP_HEIGHT - 1, centerY + radius); y++) {
            for (let x = Math.max(0, centerX - radius); x <= Math.min(CONFIG.MAP_WIDTH - 1, centerX + radius); x++) {
                if (Math.hypot(x - centerX, y - centerY) <= radius) {
                    gameState.visibility[y][x] = true;
                    gameState.explored[y][x] = true;
                }
            }
        }
    };
    const myRole = gameState.myRole || 'player';
    const myTeam = (gameState.teams && gameState.teams[myRole]) || 1;
    for (const unit of gameState.units) {
        if (unit.health <= 0) continue;
        const uTeam = (gameState.teams && gameState.teams[unit.owner]) || (unit.owner === 'player' ? 1 : 2);
        if (unit.owner === myRole || (!unit.isNeutral && uTeam === myTeam)) {
            reveal(unit.x, unit.y, CONFIG.UNIT_SIGHT_RANGE);
        }
    }
    for (const building of gameState.buildings) {
        if (building.health <= 0) continue;
        const bTeam = (gameState.teams && gameState.teams[building.owner]) || (building.owner === 'player' ? 1 : 2);
        if (building.owner === myRole || bTeam === myTeam) {
            reveal((building.x + building.width / 2) * CONFIG.TILE_SIZE, (building.y + building.height / 2) * CONFIG.TILE_SIZE, CONFIG.BUILDING_SIGHT_RANGE);
        }
    }
}

function updateBotVision(botId = 'bot1') {
    const aiState = (gameState.aiStates && gameState.aiStates[botId]) || gameState.aiState;
    if (!aiState) return;

    const botEntities = [
        ...gameState.units.filter(u => u.owner === botId && u.health > 0),
        ...gameState.buildings.filter(b => b.owner === botId && b.health > 0)
    ];

    const hostileBuildings = gameState.buildings.filter(b => b.health > 0 && isEntityHostile({ owner: botId }, b));
    const hostileUnits = gameState.units.filter(u => u.health > 0 && isEntityHostile({ owner: botId }, u));

    if (!aiState.knownPlayerBuildings) aiState.knownPlayerBuildings = [];
    if (!aiState.knownPlayerUnits) aiState.knownPlayerUnits = [];

    // Descobrir prédios hostis que entrarem no raio de visão
    for (const hb of hostileBuildings) {
        const hbPos = getEntityPosition(hb);
        for (const be of botEntities) {
            const bePos = getEntityPosition(be);
            const sightDist = (be.width ? CONFIG.BUILDING_SIGHT_RANGE : CONFIG.UNIT_SIGHT_RANGE) * CONFIG.TILE_SIZE;
            const dist = Math.hypot(hbPos.x - bePos.x, hbPos.y - bePos.y);
            if (dist <= sightDist) {
                if (!aiState.knownPlayerBuildings.some(kb => kb.id === hb.id)) {
                    aiState.knownPlayerBuildings.push({
                        id: hb.id,
                        name: hb.name,
                        x: hb.x,
                        y: hb.y,
                        width: hb.width,
                        height: hb.height,
                        ref: hb
                    });
                }
                break;
            }
        }
    }

    // Limpar prédios destruídos
    aiState.knownPlayerBuildings = aiState.knownPlayerBuildings.filter(kb => {
        return gameState.buildings.some(b => b.id === kb.id && b.health > 0);
    });

    // Atualizar unidades hostis no alcance de visão
    aiState.knownPlayerUnits = [];
    for (const hu of hostileUnits) {
        for (const be of botEntities) {
            const bePos = getEntityPosition(be);
            const sightDist = (be.width ? 7 : 6) * CONFIG.TILE_SIZE;
            const dist = Math.hypot(hu.x - bePos.x, hu.y - bePos.y);
            if (dist <= sightDist) {
                aiState.knownPlayerUnits.push({
                    id: hu.id,
                    x: hu.x,
                    y: hu.y,
                    ref: hu
                });
                break;
            }
        }
    }
}

function updateEnemyVision() {
    if (gameState.botConfigs && gameState.botConfigs.length > 0) {
        for (const bot of gameState.botConfigs) {
            updateBotVision(bot.id);
        }
    } else {
        updateBotVision('enemy');
    }
}


function updateGame() {
    if (gameState.gameOver || !gameState.gameStarted) return;

    // No modo multiplayer, o Joiner (enemy) NÃO executa a simulação.
    // Ele recebe snapshots do Host via BroadcastChannel.
    // Só atualiza fog of war, partículas e projéteis (visuais).
    const isJoiner = gameState.gameMode === 'multiplayer' && gameState.myRole === 'enemy';

    if (!isJoiner) {
        // === SIMULAÇÃO AUTORITATIVA (Host ou Single-player) ===
        updateTownHallResearch();

        // Atualizar unidades
        for (const unit of gameState.units) {
            unit.update();
        }

        function updateTownHallResearch() {
            const research = gameState.activeResearch;
            if (!research) return;
            research.remaining--;
            if (research.remaining <= 0) {
                const tech = TECHNOLOGY_DEFS[research.id];
                if (tech) tech.apply();
                if (!gameState.researchedTechs.includes(research.id)) gameState.researchedTechs.push(research.id);
                gameState.activeResearch = null;
            }
        }

        // Atualizar edifícios (como torres de defesa que atiram automaticamente)
        for (const building of gameState.buildings) {
            if (building.update) {
                building.update();
            }
        }

        // Resolver colisões e sobreposições entre unidades
        resolveUnitCollisions();

        // Remover mortos
        gameState.units = gameState.units.filter(unit => {
            if (unit.health <= 0) {
                // Partículas de morte
                const particleColor = unit.isHero ? '#f59e0b' : unit.isNeutral ? '#a855f7' : unit.isEnemy ? '#ff4444' : '#4444ff';
                for (let i = 0; i < 10; i++) {
                    gameState.particles.push({
                        x: unit.x, y: unit.y,
                        vx: (Math.random() - 0.5) * 5,
                        vy: (Math.random() - 0.5) * 5,
                        life: 25, maxLife: 25,
                        color: particleColor,
                        size: 4,
                    });
                }

                // Tratar morte do Herói
                if (unit.isHero && unit.owner === 'player') {
                    gameState.hero = null;
                    gameState.heroDead = true;
                    showToast(`💀 Seu Herói caiu em batalha! Reviva-o no Altar dos Reis.`);
                }

                // Recompensa de creep neutro
                if (unit.isNeutral) {
                    const xpGain = unit.xpReward || 40;
                    const goldGain = unit.goldReward || 20;
                    gameState.resources.gold += goldGain;

                    // Conceder XP se o herói do jogador estiver vivo
                    if (gameState.hero && gameState.hero.health > 0) {
                        addHeroXP(xpGain);
                    }
                    showToast(`⚔️ Creep derrotado! +${goldGain}🪙 Ouro | +${xpGain}⭐ XP`);
                } else if (!unit.isEnemy && !unit.isNeutral) {
                    gameState.resources.foodUsed = Math.max(0, gameState.resources.foodUsed - 1);
                } else if (unit.isEnemy) {
                    gameState.enemyResources.foodUsed = Math.max(0, gameState.enemyResources.foodUsed - 1);
                    // Matar unidades inimigas também dá XP ao herói se presente
                    if (gameState.hero && gameState.hero.health > 0) {
                        addHeroXP(CONFIG.HERO_KILL_XP);
                    }
                }
                return false;
            }
            return true;
        });

        // Remover edifícios destruídos
        gameState.buildings = gameState.buildings.filter(b => {
            if (b.health <= 0) {
                return false;
            }
            return true;
        });

        // IA inimiga automática (roda no single-player ou no Host em multiplayer se houver bots configurados)
        const hasBots = gameState.botConfigs && gameState.botConfigs.length > 0;
        const shouldRunAI = gameState.gameMode !== 'multiplayer' || hasBots;
        if (shouldRunAI) {
            gameState.aiTimer++;
            if (gameState.aiTimer >= CONFIG.AI_UPDATE_INTERVAL) {
                updateEnemyAI();
                gameState.aiTimer = 0;
            }
        }

        // Verificar vitória e derrota baseada em times
        const myRole = gameState.myRole || 'player';
        const myTeam = (gameState.teams && gameState.teams[myRole]) || 1;

        // Entidades do meu time
        const myTeamTownHalls = gameState.buildings.filter(b => {
            const t = (gameState.teams && gameState.teams[b.owner]) || (b.owner === 'player' ? 1 : 2);
            return t === myTeam && (b.name === 'Town Hall' || b.type?.name === 'Town Hall');
        });
        const myTeamUnits = gameState.units.filter(u => {
            const t = (gameState.teams && gameState.teams[u.owner]) || (u.owner === 'player' ? 1 : 2);
            return t === myTeam && !u.isNeutral;
        });

        if (myTeamTownHalls.length === 0 && myTeamUnits.length === 0) {
            endGame(false);
            return;
        }

        // Entidades de times hostis
        const hostileTownHalls = gameState.buildings.filter(b => {
            const t = (gameState.teams && gameState.teams[b.owner]) || (b.owner === 'player' ? 1 : 2);
            return t !== myTeam && (b.name === 'Town Hall' || b.type?.name === 'Town Hall');
        });
        const hostileUnits = gameState.units.filter(u => {
            const t = (gameState.teams && gameState.teams[u.owner]) || (u.owner === 'player' ? 1 : 2);
            return t !== myTeam && !u.isNeutral;
        });

        if (hostileTownHalls.length === 0 && hostileUnits.length === 0) {
            endGame(true);
            return;
        }


        // Sincronizar estado para o Joiner (multiplayer)
        networkTick();
    } else {
        // === PREDIÇÃO E MOVIMENTO LOCAL DO CLIENTE (Joiner a 60 FPS) ===
        for (const unit of gameState.units) {
            unit.updateMovement();
        }
        for (const building of gameState.buildings) {
            if (building.updateVisuals) building.updateVisuals();
        }
        resolveUnitCollisions();
    }

    // Atualizar projéteis (visível e animado em 60 FPS no Host e Joiner)
    for (const proj of gameState.projectiles) {
        if (proj.target && proj.target.health > 0) {
            const targetPosition = getEntityPosition(proj.target);
            const dx = targetPosition.x - proj.x;
            const dy = targetPosition.y - proj.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 8) {
                if (!isJoiner) {
                    proj.target.health -= proj.damage;
                }
                proj.dead = true;
            } else {
                proj.x += (dx / dist) * proj.speed;
                proj.y += (dy / dist) * proj.speed;
            }
        } else {
            proj.dead = true;
        }
    }
    gameState.projectiles = gameState.projectiles.filter(p => !p.dead);

    // === VISUAL (ambos Host e Joiner) ===
    // Atualizar partículas (visual)
    for (const p of gameState.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
    }
    gameState.particles = gameState.particles.filter(p => p.life > 0);

    updateFogOfWar();
    const shouldRunVision = !isJoiner && (gameState.gameMode !== 'multiplayer' || (gameState.botConfigs && gameState.botConfigs.length > 0));
    if (shouldRunVision) updateEnemyVision();
}

function buildBotStructure(botId, type, nearPosition) {
    const def = BUILDING_DEFS[type];
    if (!def) return false;
    const costGold = def.costGold ?? 150;
    const costWood = def.costWood ?? 100;

    const botRes = (gameState.factionResources && gameState.factionResources[botId]) || gameState.enemyResources;
    if (botRes.gold < costGold || botRes.wood < costWood) {
        return false;
    }

    const minR = (type === 'TOWN_HALL') ? 0 : 3;
    const maxR = (type === 'TOWN_HALL') ? 5 : 12;

    let bestX = null;
    let bestY = null;

    for (let r = minR; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const testX = nearPosition.x + dx;
                const testY = nearPosition.y + dy;

                if (testX < 2 || testX + def.width >= CONFIG.MAP_WIDTH - 2 ||
                    testY < 2 || testY + def.height >= CONFIG.MAP_HEIGHT - 2) {
                    continue;
                }

                // Verificar terreno
                let canPlace = true;
                for (let h = 0; h < def.height; h++) {
                    for (let w = 0; w < def.width; w++) {
                        const tx = testX + w;
                        const ty = testY + h;
                        const terrain = gameState.map[ty]?.[tx];
                        if (terrain !== TERRAIN.GRASS && terrain !== TERRAIN.PATH) {
                            canPlace = false;
                            break;
                        }
                    }
                    if (!canPlace) break;
                }

                if (!canPlace) continue;

                // Verificar colisão com prédios existentes
                for (const b of gameState.buildings) {
                    if (testX < b.x + b.width + 1 && testX + def.width + 1 > b.x &&
                        testY < b.y + b.height + 1 && testY + def.height + 1 > b.y) {
                        canPlace = false;
                        break;
                    }
                }

                if (canPlace) {
                    bestX = testX;
                    bestY = testY;
                    break;
                }
            }
            if (bestX !== null) break;
        }
        if (bestX !== null) break;
    }

    if (bestX === null) return false;

    botRes.gold -= costGold;
    botRes.wood -= costWood;

    // Criar canteiro de obras da IA
    const newBuilding = new Building(def, bestX, bestY, botId, false);
    gameState.buildings.push(newBuilding);

    // Designar o peão mais próximo desta facção para construir
    const availablePeons = gameState.units.filter(u => u.owner === botId && u.canGather && u.health > 0);
    if (availablePeons.length > 0) {
        const bPos = getEntityPosition(newBuilding);
        let closestPeon = null;
        let minDist = Infinity;
        for (const peon of availablePeons) {
            const isBusyBuilding = peon.buildingTarget && !peon.buildingTarget.isConstructed;
            const dist = Math.hypot(peon.x - bPos.x, peon.y - bPos.y) + (isBusyBuilding ? 600 : 0);
            if (dist < minDist) {
                minDist = dist;
                closestPeon = peon;
            }
        }
        if (closestPeon) {
            closestPeon.assignBuild(newBuilding);
        }
    }

    return newBuilding;
}

function updateBotAI(botId = 'bot1') {
    const aiState = (gameState.aiStates && gameState.aiStates[botId]) || gameState.aiState;
    if (!aiState) return;

    const botRes = (gameState.factionResources && gameState.factionResources[botId]) || gameState.enemyResources;
    const botUnits = gameState.units.filter(u => u.owner === botId && u.health > 0);
    const botBuildings = gameState.buildings.filter(b => b.owner === botId && b.health > 0);
    const botTownHalls = botBuildings.filter(b => b.name === 'Town Hall' && b.isConstructed);
    const botPeasants = botUnits.filter(u => u.canGather);
    const botArmy = botUnits.filter(u => !u.canGather && u.canAttack);

    // Dificuldade: Bônus de renda periódica se Médio ou Difícil
    if (botRes.bonusInterval && botRes.bonusInterval > 0) {
        aiState._bonusTimer = (aiState._bonusTimer || 0) + 1;
        if (aiState._bonusTimer >= botRes.bonusInterval) {
            aiState._bonusTimer = 0;
            const bonusGold = aiState.difficulty === 'HARD' ? 35 : 15;
            const bonusWood = aiState.difficulty === 'HARD' ? 25 : 10;
            botRes.gold += bonusGold;
            botRes.wood += bonusWood;
        }
    }

    if (botTownHalls.length === 0) {
        if (aiState.knownPlayerUnits && aiState.knownPlayerUnits.length > 0) {
            const primeThreat = aiState.knownPlayerUnits[0].ref;
            for (const soldier of botArmy) {
                soldier.attackTarget = primeThreat;
                soldier.targetX = primeThreat.x;
                soldier.targetY = primeThreat.y;
            }
        }
        return;
    }

    const mainBase = botTownHalls[0];
    const canAfford = (gold, wood) => botRes.gold >= gold && botRes.wood >= wood;

    if (aiState.expansionCooldown > 0) {
        aiState.expansionCooldown--;
    }
    aiState.lastAttackTimer = (aiState.lastAttackTimer || 0) + 1;

    // Garantir que edifícios em obras tenham pelo menos 1 operário
    const unfinishedBuildings = botBuildings.filter(b => !b.isConstructed);
    for (const ub of unfinishedBuildings) {
        const hasWorker = botPeasants.some(p => p.buildingTarget === ub);
        if (!hasWorker && botPeasants.length > 0) {
            const bPos = getEntityPosition(ub);
            let closestPeon = null;
            let minDist = Infinity;
            for (const peon of botPeasants) {
                const isBusy = (peon.buildingTarget && !peon.buildingTarget.isConstructed) || (peon.repairTarget && peon.repairTarget.health < peon.repairTarget.maxHealth);
                const dist = Math.hypot(peon.x - bPos.x, peon.y - bPos.y) + (isBusy ? 600 : 0);
                if (dist < minDist) {
                    minDist = dist;
                    closestPeon = peon;
                }
            }
            if (closestPeon) {
                closestPeon.assignBuild(ub);
            }
        }
    }

    // Reparo de edifícios danificados
    const damagedBuildings = botBuildings.filter(b => b.isConstructed && b.health < b.maxHealth);
    for (const db of damagedBuildings) {
        const hasRepairer = botPeasants.some(p => p.repairTarget === db);
        if (!hasRepairer && botPeasants.length > 0) {
            const bPos = getEntityPosition(db);
            let closestPeon = null;
            let minDist = Infinity;
            for (const peon of botPeasants) {
                const isBusy = (peon.buildingTarget && !peon.buildingTarget.isConstructed) || (peon.repairTarget && peon.repairTarget.health < peon.repairTarget.maxHealth);
                const dist = Math.hypot(peon.x - bPos.x, peon.y - bPos.y) + (isBusy ? 600 : 0);
                if (dist < minDist) {
                    minDist = dist;
                    closestPeon = peon;
                }
            }
            if (closestPeon) {
                closestPeon.assignRepair(db);
            }
        }
    }

    // 1. Gestão Econômica
    const goldPeons = botPeasants.filter(p => p.gatherType === 'gold').length;
    const woodPeons = botPeasants.filter(p => p.gatherType === 'wood').length;

    for (const peasant of botPeasants) {
        if (!peasant.gathering && !peasant.returning && !peasant.buildingTarget && !peasant.repairTarget) {
            peasant.autoGathering = true;
            const preferGold = botRes.gold < 150 || (goldPeons <= woodPeons);
            peasant.findResource(preferGold ? 'gold' : 'wood');
        }
    }

    // Treinar peões (mantém 3-4 por base)
    const targetPeonCount = Math.min(10, botTownHalls.length * 3 + 1);
    if (botPeasants.length < targetPeonCount &&
        botRes.foodUsed < botRes.foodMax &&
        canAfford(50, 25)) {

        const spawnBase = botTownHalls[botPeasants.length % botTownHalls.length] || mainBase;
        const bPos = getEntityPosition(spawnBase);
        botRes.gold -= 50;
        botRes.wood -= 25;
        botRes.foodUsed += 1;

        const standPos = getStandPositionNearBuilding(spawnBase, bPos.x, bPos.y + spawnBase.height * CONFIG.TILE_SIZE, 8);
        const newPeon = new Unit(UNIT_DEFS.PEASANT, standPos.x, standPos.y, botId);
        newPeon.autoGathering = true;
        gameState.units.push(newPeon);
        const preferGold = botRes.gold < 150 || (goldPeons <= woodPeons);
        newPeon.findResource(preferGold ? 'gold' : 'wood');
    }

    // 2. Expansão de bases secundárias
    const botHouses = botBuildings.filter(b => b.name === 'Casa' && b.isConstructed);
    const botBarracks = botBuildings.filter(b => b.name === 'Quartel' && b.isConstructed);
    const botArchery = botBuildings.filter(b => b.name === 'Arco e Flecha' && b.isConstructed);
    const botAltars = botBuildings.filter(b => b.name === 'Altar dos Reis' && b.isConstructed);
    const botForges = botBuildings.filter(b => b.name === 'Forja' && b.isConstructed);
    const botHeroes = botUnits.filter(u => u.isHero);

    const hasCoreBase = botTownHalls.length >= 1 && botBarracks.length >= 1 && botHouses.length >= 1;
    const hasSurplusForExpansion = canAfford(200, 150) && botPeasants.length >= 3;

    if (hasCoreBase && hasSurplusForExpansion && aiState.expansionCooldown <= 0 && botTownHalls.length < 3) {
        const candidateHubs = (aiState.candidateHubs || []).filter(hub => {
            const hasBotBuildingNearby = botBuildings.some(b => Math.hypot(b.x - hub.base.x, b.y - hub.base.y) < 14);
            const hasEnemyNearby = (aiState.knownPlayerBuildings || []).some(kb => Math.hypot(kb.x - hub.base.x, kb.y - hub.base.y) < 16);
            return !hasBotBuildingNearby && !hasEnemyNearby;
        });

        if (candidateHubs.length > 0) {
            const chosenHub = candidateHubs[0];
            const newBase = buildBotStructure(botId, 'TOWN_HALL', chosenHub.base);
            if (newBase) {
                aiState.expansionCooldown = 600;
            }
        }
    }

    // 3. Construção de Estruturas Variadas e População
    const needsFood = botRes.foodUsed >= botRes.foodMax - 3;
    if (needsFood && canAfford(100, 50) && botBuildings.length < 30) {
        // Casas para sustentar o exército
        const targetBase = botTownHalls[botHouses.length % botTownHalls.length] || mainBase;
        buildBotStructure(botId, 'HOUSE', targetBase);
    } else if (botBarracks.length < Math.min(2, botTownHalls.length) && canAfford(150, 100)) {
        // Quartel principal e secundário
        const targetBase = botTownHalls[botBarracks.length % botTownHalls.length] || mainBase;
        buildBotStructure(botId, 'BARRACKS', targetBase);
    } else if (botArchery.length < 1 && canAfford(125, 75)) {
        // Campo de Arquearia
        buildBotStructure(botId, 'ARCHERY_RANGE', mainBase);
    } else if (botAltars.length < 1 && canAfford(180, 100)) {
        // Altar dos Reis para treinar Herói
        buildBotStructure(botId, 'ALTAR', mainBase);
    } else if (botForges.length < 1 && canAfford(180, 120)) {
        // Forja para tecnologias e melhorias
        buildBotStructure(botId, 'BLACKSMITH', mainBase);
    } else {
        // Torres defensivas nas bases
        for (const th of botTownHalls) {
            const towersNearBase = botBuildings.filter(b => b.name === 'Torre' && Math.hypot(b.x - th.x, b.y - th.y) < 8);
            if (towersNearBase.length < 2 && canAfford(150, 50)) {
                buildBotStructure(botId, 'TOWER', th);
                break;
            }
        }
    }

    // 4. Treinamento do Herói (Altar dos Reis)
    if (botAltars.length > 0 && botHeroes.length === 0) {
        const altar = botAltars.find(a => a.isConstructed);
        if (altar && canAfford(200, 100) && botRes.foodUsed < botRes.foodMax) {
            botRes.gold -= 200;
            botRes.wood -= 100;
            botRes.foodUsed += 2;
            const aPos = getEntityPosition(altar);
            const standPos = getStandPositionNearBuilding(altar, aPos.x, aPos.y + altar.height * CONFIG.TILE_SIZE, 16);
            const hero = new Unit(UNIT_DEFS.HERO_PALADIN, standPos.x, standPos.y, botId);
            hero.name = `Herói de ${botId === 'enemy' ? 'Orcs' : botId.toUpperCase()}`;
            hero.color = CONFIG.FACTION_COLORS[botId] || '#f59e0b';
            gameState.units.push(hero);
            showToast(`⚠️ Um Herói inimigo foi convocado pelo exército de ${botId}!`);
        }
    }

    // 5. Treinamento Militar Ativo (Quartel e Campo de Tiro)
    for (const barracks of botBarracks) {
        if (!barracks.isConstructed) continue;
        if (botRes.foodUsed < botRes.foodMax && botArmy.length < 25) {
            const isShaman = (botArmy.length + 1) % 4 === 0;
            const unitDef = isShaman ? UNIT_DEFS.ORC_SHAMAN : UNIT_DEFS.ORC_WARRIOR;
            const costG = unitDef.costGold || 100;
            const costW = unitDef.costWood || 50;

            if (canAfford(costG, costW)) {
                botRes.gold -= costG;
                botRes.wood -= costW;
                botRes.foodUsed += 1;

                const bPos = getEntityPosition(barracks);
                const standPos = getStandPositionNearBuilding(barracks, bPos.x, bPos.y + barracks.height * CONFIG.TILE_SIZE, unitDef.size || 9);
                const soldier = new Unit(unitDef, standPos.x, standPos.y, botId);
                gameState.units.push(soldier);
            }
        }
    }

    for (const range of botArchery) {
        if (!range.isConstructed) continue;
        if (botRes.foodUsed < botRes.foodMax && botArmy.length < 25) {
            const unitDef = UNIT_DEFS.ARCHER;
            if (canAfford(unitDef.costGold || 75, unitDef.costWood || 40)) {
                botRes.gold -= unitDef.costGold || 75;
                botRes.wood -= unitDef.costWood || 40;
                botRes.foodUsed += 1;

                const bPos = getEntityPosition(range);
                const standPos = getStandPositionNearBuilding(range, bPos.x, bPos.y + range.height * CONFIG.TILE_SIZE, unitDef.size || 8);
                const archer = new Unit(unitDef, standPos.x, standPos.y, botId);
                gameState.units.push(archer);
            }
        }
    }

    // 6. Defesa e Esquadrões de Combate
    const garrisonRequired = Math.min(botArmy.length, 2);
    const garrisonUnits = botArmy.slice(0, garrisonRequired);
    const strikeSquad = botArmy.slice(garrisonRequired);

    let activeThreat = null;
    let minThreatDist = Infinity;

    for (const th of botTownHalls) {
        const thPos = getEntityPosition(th);
        for (const pu of aiState.knownPlayerUnits || []) {
            const dist = Math.hypot(pu.x - thPos.x, pu.y - thPos.y);
            if (dist < 320 && dist < minThreatDist) {
                minThreatDist = dist;
                activeThreat = pu.ref;
            }
        }
    }

    if (!activeThreat) {
        for (const peon of botPeasants) {
            for (const pu of aiState.knownPlayerUnits || []) {
                const dist = Math.hypot(pu.x - peon.x, pu.y - peon.y);
                if (dist < 220 && dist < minThreatDist) {
                    minThreatDist = dist;
                    activeThreat = pu.ref;
                }
            }
        }
    }

    if (activeThreat && activeThreat.health > 0) {
        aiState.attackState = 'DEFENDING';
        for (const defender of garrisonUnits) {
            defender.attackTarget = activeThreat;
            defender.targetX = activeThreat.x;
            defender.targetY = activeThreat.y;
        }
        for (const soldier of strikeSquad) {
            soldier.attackTarget = activeThreat;
            soldier.targetX = activeThreat.x;
            soldier.targetY = activeThreat.y;
        }
        return;
    }

    // Patrulha defensiva para a guarnição mínima
    garrisonUnits.forEach((defender, idx) => {
        const baseIndex = idx % botTownHalls.length;
        const assignedBase = botTownHalls[baseIndex];
        const bPos = getEntityPosition(assignedBase);
        const countForThisBase = Math.ceil(garrisonUnits.length / botTownHalls.length);
        const subIdx = Math.floor(idx / botTownHalls.length);
        const angle = (subIdx / Math.max(1, countForThisBase)) * Math.PI * 2;
        const guardDist = 65 + (subIdx % 2) * 15;

        const targetX = bPos.x + Math.cos(angle) * guardDist;
        const targetY = bPos.y + Math.sin(angle) * guardDist;

        if (defender.attackTarget === null && Math.hypot(defender.x - targetX, defender.y - targetY) > 35) {
            defender.targetX = targetX;
            defender.targetY = targetY;
        }
    });

    // 7. Ofensiva Pró-Ativa e Ataques Periódicos
    // A IA ataca assim que tiver ao menos 2 combatentes (ou 1 herói) no esquadrão
    const hasHeroInSquad = strikeSquad.some(u => u.isHero);
    const hasSurplusMilitary = strikeSquad.length >= (hasHeroInSquad ? 1 : 2);
    const canLaunchAttack = hasSurplusMilitary || aiState.lastAttackTimer >= 400;

    if (canLaunchAttack || aiState.attackState === 'ATTACKING') {
        aiState.lastAttackTimer = 0;
        const playerTownHall = gameState.buildings.find(b => b.owner === 'player' && (b.name === 'Town Hall' || b.type?.name === 'Town Hall') && b.health > 0);
        const anyPlayerBuilding = gameState.buildings.find(b => b.owner === 'player' && b.health > 0);
        const anyPlayerUnit = gameState.units.find(u => u.owner === 'player' && u.health > 0);

        aiState.attackState = 'ATTACKING';
        const primeTarget = playerTownHall || anyPlayerBuilding || anyPlayerUnit;

        if (primeTarget) {
            const targetPos = getEntityPosition(primeTarget);
            assignFormationPositions(strikeSquad, targetPos.x, targetPos.y);
            for (const soldier of strikeSquad) {
                if (!soldier.attackTarget || soldier.attackTarget.health <= 0) {
                    soldier.attackTarget = primeTarget;
                }
            }
        } else {
            // Rota de patrulha ofensiva caso ainda não tenha visto construções do jogador
            aiState.attackState = 'SCOUTING';
            const waypoints = aiState.scoutWaypoints || [{ x: 14, y: 14 }, { x: 40, y: 40 }];
            let currentWp = waypoints[aiState.scoutWaypointIndex % waypoints.length];
            const wpX = currentWp.x * CONFIG.TILE_SIZE;
            const wpY = currentWp.y * CONFIG.TILE_SIZE;

            assignFormationPositions(strikeSquad, wpX, wpY);

            if (strikeSquad.length > 0 && Math.hypot(strikeSquad[0].x - wpX, strikeSquad[0].y - wpY) < 90) {
                aiState.scoutWaypointIndex = (aiState.scoutWaypointIndex + 1) % waypoints.length;
            }
        }
    } else {
        aiState.attackState = 'IDLE';
        const bPos = getEntityPosition(mainBase);
        strikeSquad.forEach((soldier, idx) => {
            if (soldier.targetX === null && soldier.targetY === null) {
                const angle = (idx / Math.max(1, strikeSquad.length)) * Math.PI * 2;
                soldier.targetX = bPos.x + Math.cos(angle) * 90;
                soldier.targetY = bPos.y + Math.sin(angle) * 90;
            }
        });
    }
}

function updateEnemyAI() {
    if (gameState.botConfigs && gameState.botConfigs.length > 0) {
        for (const bot of gameState.botConfigs) {
            updateBotAI(bot.id);
        }
    } else {
        updateBotAI('enemy');
    }
}


function endGame(victory) {
    gameState.gameOver = true;
    const gameOverDiv = document.getElementById('gameOver');
    const titleEl = document.getElementById('gameOverTitle');
    const textEl = document.getElementById('gameOverText');

    gameOverDiv.style.display = 'flex';

    if (victory) {
        titleEl.textContent = '🏆 VITÓRIA! 🏆';
        titleEl.className = 'victory';
        textEl.textContent = 'Você destruiu todas as bases e o exército orc!';
    } else {
        titleEl.textContent = '💀 DERROTA 💀';
        titleEl.className = 'defeat';
        textEl.textContent = 'Seu reino caiu diante das forças orcs!';
    }
}

export { initGame, updateGame, updateEnemyAI, endGame, updateFogOfWar, updateEnemyVision };
