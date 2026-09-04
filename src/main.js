import { CONFIG } from './config.js';
import { gameState } from './state.js';
import { initGame, updateGame } from './systems.js';
import { render } from './render.js';
import { setupInput, updateCamera } from './input.js';
import { showToast, setupInGameChat } from './ui.js';
import { mapManager } from './mapManager.js';
import { lobbyController } from './lobby.js';
import { networkTick } from './network.js'; // <-- CORRIGIDO: importação explícita

window.gameState = gameState;

const canvas = document.getElementById('gameCanvas');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const multiplayerChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('kingdom-wars-matchmaking')
    : null;
let multiplayerClientId = Math.random().toString(36).slice(2);
window.multiplayerClientId = multiplayerClientId;
if (lobbyController) {
    lobbyController.clientId = multiplayerClientId;
}
let lobbyActive = false;

let selectedMapIndex = 0;
let selectedMapSeed = Math.random();

function startMatch(mode, mapIndex = selectedMapIndex, mapSeed = selectedMapSeed, role = 'player', customConfig = null) {
    gameState.gameMode = mode;
    gameState.myRole = (mode === 'multiplayer') ? role : 'player';
    gameState.gameStarted = true;
    selectedMapIndex = mapIndex;
    selectedMapSeed = mapSeed;
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('multiplayerLobby')?.classList.remove('visible');
    document.getElementById('multiplayerLobbyRoomScreen')?.classList.remove('visible');
    document.getElementById('mapSelection')?.classList.remove('visible');
    document.getElementById('multiplayerCreateGameScreen')?.classList.remove('visible');
    document.getElementById('multiplayerBrowser')?.classList.remove('visible');
    initGame(selectedMapIndex, selectedMapSeed, customConfig);
    requestAnimationFrame(gameLoop);
}

// CORRIGIDO: gameLoop usando updateGame real e tratando Joiner sem quebrar renderização
function gameLoop(timestamp) {
    if (!gameState.lastTime) gameState.lastTime = timestamp;
    const dt = Math.min(100, timestamp - gameState.lastTime);
    gameState.lastTime = timestamp;

    updateCamera();

    if (gameState.gameMode === 'multiplayer') {
        if (gameState.myRole === 'player') {
            // HOST: Roda física, colisão, IA e disparo de snapshots
            updateGame(dt);
            networkTick();
        } else {
            // JOINER: Roda interpolação de rede das tropas
            networkTick();

            // Atualiza a névoa e visibilidade do mapa para as tropas vermelhas
            if (typeof updateFogOfWar === 'function') {
                updateFogOfWar();
            }

            // Mantém partículas, projéteis e animações visuais leves
            if (gameState.particles) {
                gameState.particles = gameState.particles.filter(p => {
                    p.x += p.vx;
                    p.y += p.vy;
                    p.life--;
                    return p.life > 0;
                });
            }
        }
    } else {
        // SINGLE-PLAYER: Jogo normal
        updateGame(dt);
    }

    render();
    requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    minimapCanvas.width = 180;
    minimapCanvas.height = 180;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
setupInput();
setupInGameChat();

let isMinimapDragging = false;

function handleMinimapNavigate(e) {
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = Math.max(0, Math.min(minimapCanvas.width, (e.clientX - rect.left) * (minimapCanvas.width / rect.width)));
    const my = Math.max(0, Math.min(minimapCanvas.height, (e.clientY - rect.top) * (minimapCanvas.height / rect.height)));

    const mapPixelW = CONFIG.MAP_WIDTH * CONFIG.TILE_SIZE;
    const mapPixelH = CONFIG.MAP_HEIGHT * CONFIG.TILE_SIZE;

    const targetWorldX = (mx / minimapCanvas.width) * mapPixelW;
    const targetWorldY = (my / minimapCanvas.height) * mapPixelH;

    const viewW = canvas.width / gameState.camera.zoom;
    const viewH = canvas.height / gameState.camera.zoom;

    gameState.camera.x = Math.max(viewW / 2, Math.min(mapPixelW - viewW / 2, targetWorldX));
    gameState.camera.y = Math.max(viewH / 2, Math.min(mapPixelH - viewH / 2, targetWorldY));
}

minimapCanvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.button === 0) {
        isMinimapDragging = true;
        handleMinimapNavigate(e);
    }
});

window.addEventListener('mousemove', (e) => {
    if (isMinimapDragging) {
        e.preventDefault();
        handleMinimapNavigate(e);
    }
});

window.addEventListener('mouseup', () => {
    isMinimapDragging = false;
});

minimapCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('gameOver').style.display = 'none';
    document.getElementById('startScreen').style.display = 'flex';
    // Limpar estado do jogo anterior
    gameState.units = [];
    gameState.buildings = [];
    gameState.projectiles = [];
    gameState.particles = [];
    gameState.selectedUnits = [];
    gameState.buildingMode = null;
    gameState.selectedBuilding = null;
    gameState.resources = { gold: CONFIG.STARTING_GOLD, wood: CONFIG.STARTING_WOOD, foodUsed: CONFIG.STARTING_FOOD_USED, foodMax: CONFIG.STARTING_FOOD_MAX };
    gameState.aiTimer = 0;
    gameState.gameOver = false;
    gameState.gameStarted = false;
});

// ==================== MULTIPLAYER SERVER BROWSER & MATCHMAKING ====================
const MAP_NAMES = [
    "Campos do Norte",
    "Vale do Leste",
    "Deserto Al'Kharid"
];

let onlineRooms = new Map();
let selectedRoomId = null;
let myHostedRoom = null;
let hostHeartbeatInterval = null;
let selectedCreateMapIndex = 0;

function updateServerBrowserUI() {
    const tbody = document.getElementById('serverListBody');
    const noServersMsg = document.getElementById('noServersMsg');
    const joinBtn = document.getElementById('joinRoomBtn');

    tbody.innerHTML = '';

    // Limpar salas que não respondem há mais de 6 segundos E estão vazias
    const now = Date.now();
    for (const [id, r] of onlineRooms.entries()) {
        const isTimeout = now - (r.lastSeen || 0) > 6000;

        // Suporta tanto array (r.players.length) quanto número (r.players ou r.playerCount)
        const playerCount = Array.isArray(r.players)
            ? r.players.length
            : (r.playerCount ?? r.players ?? 0);

        const isEmpty = playerCount === 0;

        if (isTimeout && isEmpty) {
            onlineRooms.delete(id);
        }
    }

    // Se o próprio cliente está hospedando uma sala, exibi-la também na lista
    const roomsList = Array.from(onlineRooms.values());
    if (myHostedRoom && !roomsList.some(r => r.id === myHostedRoom.id)) {
        roomsList.push({
            ...myHostedRoom,
            players: 1,
            maxPlayers: 2,
            ping: 1,
            isSelf: true
        });
    }

    if (roomsList.length === 0) {
        noServersMsg.classList.remove('hidden');
        joinBtn.disabled = true;
        selectedRoomId = null;
        return;
    }

    noServersMsg.classList.add('hidden');

    roomsList.forEach(room => {
        const tr = document.createElement('tr');
        if (selectedRoomId === room.id) {
            tr.classList.add('selected');
        }

        const isPriv = room.isPrivate || !!room.hasPassword;
        const visBadge = isPriv
            ? '<span class="badge-vis private">🔒 Privada</span>'
            : '<span class="badge-vis public">🌐 Pública</span>';

        const pingVal = room.ping ?? 8;
        const pingClass = pingVal < 40 ? '' : pingVal < 100 ? 'medium' : 'slow';

        tr.innerHTML = `
            <td>${visBadge}</td>
            <td><div class="server-room-name">🏰 ${escapeHtml(room.name)} ${room.isSelf ? '<small style="color:var(--accent);">(Sua Sala)</small>' : ''}</div></td>
            <td style="color: var(--accent); font-weight: 500;">${escapeHtml(room.mapName || MAP_NAMES[room.mapIndex] || 'Padrão')}</td>
            <td><strong>${room.players || 1}/${room.maxPlayers || 2}</strong></td>
            <td>
                <div class="ping-cell">
                    <span class="ping-dot ${pingClass}"></span>
                    <span>${pingVal} ms</span>
                </div>
            </td>
        `;

        tr.addEventListener('click', () => {
            if (room.isSelf) {
                showToast('Você já é o anfitrião desta sala!');
                return;
            }
            selectedRoomId = room.id;
            joinBtn.disabled = false;
            updateServerBrowserUI();
        });

        tr.addEventListener('dblclick', () => {
            if (!room.isSelf) {
                selectedRoomId = room.id;
                attemptJoinRoom(room);
            }
        });

        tbody.appendChild(tr);
    });

    const isSelectedAvailable = selectedRoomId && roomsList.some(r => r.id === selectedRoomId && !r.isSelf);
    joinBtn.disabled = !isSelectedAvailable;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
}

function queryOnlineRooms() {
    if (!multiplayerChannel) return;
    multiplayerChannel.postMessage({
        type: 'query_rooms',
        senderClientId: multiplayerClientId,
        sentAt: Date.now()
    });

    // Ler também de localStorage como fallback entre abas
    try {
        const raw = localStorage.getItem('kingdom_wars_rooms_v1');
        if (raw) {
            const parsed = JSON.parse(raw);
            const now = Date.now();
            Object.values(parsed).forEach(r => {
                if (now - (r.lastHeartbeat || 0) < 5000 && r.hostClientId !== multiplayerClientId) {
                    onlineRooms.set(r.id, {
                        ...r,
                        ping: Math.max(2, Math.min(25, Math.floor(Math.random() * 12 + 3))),
                        lastSeen: now
                    });
                }
            });
        }
    } catch (e) {
        // Ignorar erro de localStorage
    }

    updateServerBrowserUI();
}

function syncRoomToLocalStorage(room) {
    try {
        const raw = localStorage.getItem('kingdom_wars_rooms_v1');
        const rooms = raw ? JSON.parse(raw) : {};
        const now = Date.now();

        if (room) {
            rooms[room.id] = {
                id: room.id,
                name: room.name,
                isPrivate: room.isPrivate,
                hasPassword: !!room.password,
                mapIndex: room.mapIndex,
                mapName: room.mapName,
                hostClientId: typeof multiplayerClientId !== 'undefined' ? multiplayerClientId : null,
                players: 1,
                maxPlayers: 2,
                lastHeartbeat: now
            };
        }

        // Limpar salas mortas no localStorage
        for (const k in rooms) {
            if (now - (rooms[k].lastHeartbeat || 0) > 4000) {
                delete rooms[k];
            }
        }
        localStorage.setItem('kingdom_wars_rooms_v1', JSON.stringify(rooms));
    } catch (e) { }
}

function removeRoomFromLocalStorage(roomId) {
    try {
        const raw = localStorage.getItem('kingdom_wars_rooms_v1');
        if (!raw) return;
        const rooms = JSON.parse(raw);
        delete rooms[roomId];
        localStorage.setItem('kingdom_wars_rooms_v1', JSON.stringify(rooms));
    } catch (e) { }
}

// Abrir Navegador de Servidores
document.getElementById('multiplayerBtn').addEventListener('click', () => {
    if (!multiplayerChannel) {
        document.getElementById('modeNotice').textContent = 'Este navegador não oferece suporte a rede local.';
        return;
    }
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('multiplayerBrowser').classList.add('visible');
    selectedRoomId = null;
    queryOnlineRooms();
});

// Botão Voltar ao Menu
document.getElementById('backToMenuBtn').addEventListener('click', () => {
    document.getElementById('multiplayerBrowser').classList.remove('visible');
    document.getElementById('startScreen').style.display = 'flex';
});

// Botão Atualizar Lista
const refreshServersBtn = document.getElementById('refreshServersBtn');
refreshServersBtn.addEventListener('click', () => {
    refreshServersBtn.classList.add('spinning');
    queryOnlineRooms();
    setTimeout(() => {
        refreshServersBtn.classList.remove('spinning');
    }, 600);
});

// Botão Criar Sala (Abaixo à direita)
document.getElementById('createRoomBtn').addEventListener('click', () => {
    document.getElementById('multiplayerBrowser').classList.remove('visible');
    lobbyController.openCreateGame();
});

// Alternância entre Pública e Privada
document.querySelectorAll('input[name="roomVisibility"]').forEach(input => {
    input.addEventListener('change', () => {
        const isPrivate = input.value === 'private';
        document.getElementById('radioPublicCard').classList.toggle('active', !isPrivate);
        document.getElementById('radioPrivateCard').classList.toggle('active', isPrivate);
        document.getElementById('passwordField').classList.toggle('hidden', !isPrivate);
    });
});

// Seleção de Mapa no Modal de Criação
document.querySelectorAll('.modal-map-option').forEach(opt => {
    opt.addEventListener('click', () => {
        selectedCreateMapIndex = Number(opt.dataset.map);
        document.querySelectorAll('.modal-map-option').forEach(el => el.classList.remove('selected'));
        opt.classList.add('selected');
    });
});

// Cancelar Criação de Sala
document.getElementById('cancelCreateRoomBtn').addEventListener('click', () => {
    document.getElementById('createRoomModal').classList.add('hidden');
});

// Confirmar Criação de Sala
document.getElementById('confirmCreateRoomBtn').addEventListener('click', () => {
    const roomName = document.getElementById('roomNameInput').value.trim() || 'Sala Real';
    const isPrivate = document.querySelector('input[name="roomVisibility"]:checked').value === 'private';
    const password = isPrivate ? document.getElementById('roomPasswordInput').value.trim() : '';

    if (isPrivate && !password) {
        showToast('Defina uma senha para a sala privada!');
        document.getElementById('roomPasswordInput').focus();
        return;
    }

    const roomId = 'room_' + Math.random().toString(36).slice(2, 10);
    const mapSeed = Math.random();

    myHostedRoom = {
        id: roomId,
        name: roomName,
        isPrivate,
        password,
        mapIndex: selectedCreateMapIndex,
        mapName: MAP_NAMES[selectedCreateMapIndex],
        mapSeed,
        hostId: multiplayerClientId,
        createdAt: Date.now()
    };

    document.getElementById('createRoomModal').classList.add('hidden');

    // Abrir Modal de Espera do Host
    document.getElementById('hostWaitingTitle').textContent = `SALA: ${myHostedRoom.name.toUpperCase()}`;
    document.getElementById('hostWaitingInfo').textContent = `Mapa: ${myHostedRoom.mapName} | ${isPrivate ? '🔒 Privada' : '🌐 Pública'}`;
    document.getElementById('hostWaitingModal').classList.remove('hidden');

    // Iniciar anúncios contínuos de presença da sala
    syncRoomToLocalStorage(myHostedRoom);
    broadcastRoomPresence();

    if (hostHeartbeatInterval) clearInterval(hostHeartbeatInterval);
    hostHeartbeatInterval = setInterval(() => {
        if (myHostedRoom) {
            syncRoomToLocalStorage(myHostedRoom);
            broadcastRoomPresence();
        }
    }, 1200);

    queryOnlineRooms();
    showToast('Sala criada! Aguardando oponente entrar...');
});

function broadcastRoomPresence(querySentAt = null) {
    if (!myHostedRoom || !multiplayerChannel) return;
    multiplayerChannel.postMessage({
        type: 'room_announce',
        room: {
            id: myHostedRoom.id,
            name: myHostedRoom.name,
            isPrivate: myHostedRoom.isPrivate,
            hasPassword: !!myHostedRoom.password,
            mapIndex: myHostedRoom.mapIndex,
            mapName: myHostedRoom.mapName,
            hostClientId: multiplayerClientId,
            players: 1,
            maxPlayers: 2
        },
        querySentAt,
        hostClientId: multiplayerClientId
    });
}

// Cancelar Sala Hospedada
document.getElementById('cancelHostWaitingBtn').addEventListener('click', () => {
    cancelHostedRoom();
});

function cancelHostedRoom() {
    if (myHostedRoom) {
        if (multiplayerChannel) {
            multiplayerChannel.postMessage({
                type: 'room_closed',
                roomId: myHostedRoom.id
            });
        }
        removeRoomFromLocalStorage(myHostedRoom.id);
        myHostedRoom = null;
    }
    if (hostHeartbeatInterval) {
        clearInterval(hostHeartbeatInterval);
        hostHeartbeatInterval = null;
    }
    document.getElementById('hostWaitingModal').classList.add('hidden');
    queryOnlineRooms();
    showToast('Sala cancelada.');
}

// Botão Entrar (Abaixo à direita)
document.getElementById('joinRoomBtn').addEventListener('click', () => {
    if (!selectedRoomId) return;
    const room = onlineRooms.get(selectedRoomId);
    if (!room) {
        showToast('Esta sala não está mais disponível.');
        queryOnlineRooms();
        return;
    }
    attemptJoinRoom(room);
});

function attemptJoinRoom(room) {
    if (room.isPrivate || room.hasPassword) {
        // Abrir prompt de senha
        document.getElementById('passwordPromptRoomName').textContent = `Digite a senha para entrar em: ${room.name}`;
        document.getElementById('joinPasswordInput').value = '';
        document.getElementById('passwordErrorMsg').classList.add('hidden');
        document.getElementById('passwordPromptModal').classList.remove('hidden');
        document.getElementById('joinPasswordInput').focus();
    } else {
        sendJoinRequest(room.id, '');
    }
}

// Cancelar Prompt de Senha
document.getElementById('cancelPasswordPromptBtn').addEventListener('click', () => {
    document.getElementById('passwordPromptModal').classList.add('hidden');
});

// Confirmar Senha para Entrar
document.getElementById('confirmPasswordPromptBtn').addEventListener('click', () => {
    const pass = document.getElementById('joinPasswordInput').value.trim();
    if (!selectedRoomId) return;
    sendJoinRequest(selectedRoomId, pass);
});

function sendJoinRequest(roomId, password) {
    if (!multiplayerChannel) return;
    showToast('Conectando à sala...');
    multiplayerChannel.postMessage({
        type: 'join_request',
        roomId,
        joinerClientId: multiplayerClientId,
        password
    });
}

// ==================== LISTENER BROADCASTCHANNEL ====================
if (typeof multiplayerChannel !== 'undefined' && multiplayerChannel) {
    multiplayerChannel.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || !msg.type) return;
        const currentClientId = typeof multiplayerClientId !== 'undefined' ? multiplayerClientId : null;

        // 1. Alguém consultou as salas
        if (msg.type === 'query_rooms') {
            if (myHostedRoom) {
                broadcastRoomPresence(msg.sentAt);
            }
        }

        // 2. Anúncio de sala recebido
        else if (msg.type === 'room_announce') {
            if (msg.hostClientId === currentClientId) return;
            const r = msg.room;
            if (!r) return;

            let calculatedPing = onlineRooms.get(r.id)?.ping || 12;
            if (msg.querySentAt) {
                calculatedPing = Math.max(1, Math.round(Date.now() - msg.querySentAt));
            }

            onlineRooms.set(r.id, {
                ...r,
                ping: calculatedPing,
                lastSeen: Date.now()
            });
            updateServerBrowserUI();
        }

        // 3. Sala fechada
        else if (msg.type === 'room_closed') {
            if (onlineRooms.has(msg.roomId)) {
                onlineRooms.delete(msg.roomId);
                if (selectedRoomId === msg.roomId) {
                    selectedRoomId = null;
                }
                updateServerBrowserUI();
            }
        }

        // 4. Pedido de entrada no Host
        else if (msg.type === 'join_request') {
            if (!myHostedRoom || msg.roomId !== myHostedRoom.id) return;

            if (myHostedRoom.isPrivate && myHostedRoom.password) {
                if (msg.password !== myHostedRoom.password) {
                    multiplayerChannel.postMessage({
                        type: 'join_rejected',
                        targetClientId: msg.joinerClientId,
                        reason: 'Senha incorreta!'
                    });
                    return;
                }
            }

            // Iniciar partida
            multiplayerChannel.postMessage({
                type: 'match_start',
                roomId: myHostedRoom.id,
                hostClientId: currentClientId,
                joinerClientId: msg.joinerClientId,
                mapIndex: myHostedRoom.mapIndex,
                mapSeed: myHostedRoom.mapSeed,
                roomName: myHostedRoom.name
            });

            const currentRoom = myHostedRoom;
            if (hostHeartbeatInterval) {
                clearInterval(hostHeartbeatInterval);
                hostHeartbeatInterval = null;
            }
            removeRoomFromLocalStorage(currentRoom.id);
            myHostedRoom = null;

            document.getElementById('hostWaitingModal')?.classList.add('hidden');
            document.getElementById('multiplayerBrowser')?.classList.remove('visible');

            if (typeof showToast === 'function') {
                showToast(`⚔️ Adversário conectado na sala ${currentRoom.name}! Você comanda o Time Azul!`);
            }
            if (typeof startMatch === 'function') {
                startMatch('multiplayer', currentRoom.mapIndex, currentRoom.mapSeed, 'player');
            }
        }

        // 5. Entrada rejeitada
        else if (msg.type === 'join_rejected') {
            if (msg.targetClientId !== currentClientId) return;
            const errorEl = document.getElementById('passwordErrorMsg');
            if (errorEl) {
                errorEl.textContent = msg.reason || 'Falha ao entrar na sala!';
                errorEl.classList.remove('hidden');
            }
            if (typeof showToast === 'function') showToast(msg.reason || 'Não foi possível entrar na sala.');
        }

        // 6. Início da partida autorizado
        else if (msg.type === 'match_start') {
            if (msg.joinerClientId !== currentClientId) return;

            document.getElementById('passwordPromptModal')?.classList.add('hidden');
            document.getElementById('multiplayerBrowser')?.classList.remove('visible');

            if (typeof showToast === 'function') {
                showToast(`⚔️ Conectado à sala ${msg.roomName}! Você comanda o Time Vermelho!`);
            }
            if (typeof startMatch === 'function') {
                startMatch('multiplayer', msg.mapIndex, msg.mapSeed, 'enemy');
            }
        }
    });
}

// ==================== WARCRAFT 3 MAP SELECTION SYSTEM ====================
let currentSelectedMapData = null;

async function refreshMapListUI() {
    const listEl = document.getElementById('wc3MapList');
    const badgeEl = document.getElementById('wc3MapCountBadge');
    const previewCanvas = document.getElementById('wc3MapPreviewCanvas');
    if (!listEl) return;

    badgeEl.textContent = 'Escaneando /maps...';
    listEl.innerHTML = '<div style="color: #a89070; padding: 12px; text-align: center;">Varrendo diretório de mapas...</div>';

    const maps = await mapManager.scanMaps();
    listEl.innerHTML = '';
    badgeEl.textContent = `${maps.length} mapa${maps.length === 1 ? '' : 's'}`;

    if (maps.length === 0) {
        listEl.innerHTML = '<div style="color: #a89070; padding: 12px; text-align: center;">Nenhum mapa encontrado em /maps.</div>';
        return;
    }

    maps.forEach((mapItem, index) => {
        const card = document.createElement('div');
        card.className = 'wc3-map-card' + (mapItem.corrupted ? ' corrupted' : '');
        card.dataset.mapId = mapItem.id;

        // Ícone baseado no tileset
        let icon = '🌲';
        if (mapItem.corrupted) icon = '⚠️';
        else if (mapItem.tileset === 'deserto') icon = '🏜️';
        else if (mapItem.tileset === 'pantano') icon = '🌫️';
        else if (mapItem.tileset === 'bosque') icon = '🍂';
        else if (mapItem.tileset === 'neve') icon = '❄️';

        card.innerHTML = `
            <div class="wc3-map-icon">${icon}</div>
            <div class="wc3-map-meta">
                <div class="wc3-map-meta-title">
                    <span>${mapItem.name}</span>
                    <small style="font-size: 10px; color: #d4af37; font-weight: normal;">${mapItem.players || ''}</small>
                </div>
                <div class="wc3-map-meta-subtitle">${mapItem.corrupted ? 'Arquivo corrompido ou inválido' : (mapItem.description || mapItem.fileName || '')}</div>
            </div>
        `;

        card.addEventListener('click', () => {
            selectMapItem(mapItem);
        });

        listEl.appendChild(card);
    });

    // Selecionar o mapa padrão ou primeiro válido
    const targetMap = mapManager.selectedMap || maps[0];
    if (targetMap) {
        selectMapItem(targetMap);
    }
}

function selectMapItem(mapItem) {
    currentSelectedMapData = mapItem;
    mapManager.selectedMap = mapItem;

    // Atualizar classe selected nos cards
    document.querySelectorAll('.wc3-map-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.mapId === mapItem.id);
    });

    // Atualizar campos de metadados à direita
    document.getElementById('wc3DetailName').textContent = mapItem.name || 'Sem nome';
    document.getElementById('wc3DetailSize').textContent = mapItem.size || (mapItem.width ? `${mapItem.width}x${mapItem.height}` : '80 x 80');
    document.getElementById('wc3DetailTileset').textContent = mapItem.tilesetName || mapItem.tileset || 'Padrão';
    document.getElementById('wc3DetailPlayers').textContent = mapItem.players || `${mapItem.suggestedPlayers || 2} Jogadores`;
    document.getElementById('wc3DetailFile').textContent = mapItem.fileName || `${mapItem.id}.json`;
    document.getElementById('wc3DetailDesc').textContent = mapItem.corrupted ? `Erro: ${mapItem.error || 'Arquivo não pôde ser lido'}` : (mapItem.description || 'Sem descrição.');

    const playBtn = document.getElementById('confirmSelectMapBtn');
    if (playBtn) {
        playBtn.disabled = !!mapItem.corrupted;
        playBtn.style.opacity = mapItem.corrupted ? '0.4' : '1';
        playBtn.style.cursor = mapItem.corrupted ? 'not-allowed' : 'pointer';
    }

    // Renderizar preview em tempo real no Canvas
    const previewCanvas = document.getElementById('wc3MapPreviewCanvas');
    if (previewCanvas) {
        mapManager.renderPreview(previewCanvas, mapItem);
    }
}

// Botão de atualizar / re-escanear
document.getElementById('refreshMapsBtn')?.addEventListener('click', () => {
    refreshMapListUI();
    showToast('📁 Pasta /maps re-escaneada com sucesso!');
});

// Botão Jogar Mapa
document.getElementById('confirmSelectMapBtn')?.addEventListener('click', () => {
    if (!currentSelectedMapData || currentSelectedMapData.corrupted) {
        showToast('Selecione um mapa válido para iniciar.');
        return;
    }

    const mapIdx = typeof currentSelectedMapData.mapIndex === 'number' ? currentSelectedMapData.mapIndex : 0;
    selectedMapIndex = mapIdx;
    selectedMapSeed = Math.random();

    const diffSelect = document.getElementById('spAiDifficultySelect');
    if (diffSelect) {
        gameState.aiDifficulty = diffSelect.value;
    }

    document.getElementById('mapSelection').classList.remove('visible');
    startMatch('single-player', selectedMapIndex, selectedMapSeed);
    showToast(`⚔️ Batalha iniciada em: ${currentSelectedMapData.name} [${gameState.aiDifficulty}]!`);
});

// Single-Player: Abrir Seleção de Mapa
document.getElementById('startBtn').addEventListener('click', () => {
    openMapSelection('single-player');
});

function openMapSelection(mode) {
    document.getElementById('startScreen').style.display = 'none';
    const screen = document.getElementById('mapSelection');
    screen.classList.add('visible');
    screen.dataset.mode = mode;
    refreshMapListUI();
}

document.getElementById('cancelMapSelection').addEventListener('click', () => {
    document.getElementById('mapSelection').classList.remove('visible');
    document.getElementById('startScreen').style.display = 'flex';
});

// ==================== LISTENERS DAS TELAS MULTIPLAYER WARCRAFT 3 ====================
// Tela 1: Criar Jogo (MENU_MULTIPLAYER_SELECT)
document.getElementById('mpCancelCreateGameBtn')?.addEventListener('click', () => {
    lobbyController.switchScreen('MULTIPLAYER_BROWSER');
});

document.getElementById('mpRefreshMapsBtn')?.addEventListener('click', () => {
    lobbyController.populateCreateGameMaps();
    showToast('Pastas de mapas atualizadas!');
});

document.getElementById('mpConfirmCreateGameBtn')?.addEventListener('click', () => {
    lobbyController.proceedToLobby();
});

// Suporte ao atalho [C] ou Enter no input da tela de criação
document.getElementById('mpCreateGameNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        lobbyController.proceedToLobby();
    }
});

// Tela 2: Sala de Espera (LOBBY_ROOM)
document.getElementById('lobbyLeaveRoomBtn')?.addEventListener('click', () => {
    const lobby = gameState.multiplayerLobby;
    if (lobby) {
        if (lobby.isHost) {
            lobbyController.stopHeartbeat();
            if (lobbyController.broadcastChannel) {
                lobbyController.broadcastChannel.postMessage({
                    type: 'room_closed',
                    roomId: 'room_' + lobbyController.clientId
                });
            }
        } else {
            if (lobbyController.broadcastChannel) {
                lobbyController.broadcastChannel.postMessage({
                    type: 'lobby_client_leave',
                    roomId: 'room_' + (lobby.hostClientId || ''),
                    senderClientId: lobbyController.clientId
                });
            }
        }
    }
    gameState.multiplayerLobby = null;
    lobbyController.switchScreen('MULTIPLAYER_BROWSER');
    queryOnlineRooms();
    showToast('Você saiu da sala.');
});

// Bate-papo do Lobby
const chatInput = document.getElementById('lobbyChatInput');
const sendChatBtn = document.getElementById('lobbySendChatBtn');

function handleSendChat() {
    if (!chatInput) return;
    const text = chatInput.value;
    if (text && text.trim()) {
        lobbyController.sendChatMessage(text);
        chatInput.value = '';
    }
}

sendChatBtn?.addEventListener('click', handleSendChat);
chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        handleSendChat();
    }
});

// Iniciar Jogo pelo Lobby (Host)
document.getElementById('lobbyStartMatchBtn')?.addEventListener('click', () => {
    const lobby = gameState.multiplayerLobby;
    if (!lobby || !lobby.mapData) {
        showToast('Nenhum mapa selecionado.');
        return;
    }

    const mapIndex = typeof lobby.mapData.mapIndex === 'number' ? lobby.mapData.mapIndex : 0;
    const mapSeed = Math.random();
    const lobbySlots = lobby.slots ? JSON.parse(JSON.stringify(lobby.slots)) : null;

    // Notificar outros jogadores conectados via canal local
    if (lobbyController.broadcastChannel) {
        lobbyController.broadcastChannel.postMessage({
            type: 'lobby_match_start',
            roomName: lobby.gameName,
            mapIndex,
            mapSeed,
            slots: lobbySlots
        });
    }

    lobbyController.stopHeartbeat();
    lobbyController.switchScreen('GAME');
    showToast(`⚔️ Partida iniciada no mapa ${lobby.mapData.name}!`);
    startMatch('multiplayer', mapIndex, mapSeed, 'player', { slots: lobbySlots });
});

// Ouvir início autorizado por outro jogador caso ingresse como cliente
if (lobbyController.broadcastChannel) {
    lobbyController.broadcastChannel.addEventListener('message', (e) => {
        const data = e.data;
        if (!data) return;
        if (data.type === 'lobby_match_start' && gameState.currentMenuScreen === 'LOBBY_ROOM') {
            lobbyController.switchScreen('GAME');
            showToast(`⚔️ Partida iniciada pelo anfitrião em ${data.roomName}!`);
            startMatch('multiplayer', data.mapIndex, data.mapSeed, 'enemy', { slots: data.slots });
        }
    });
}



