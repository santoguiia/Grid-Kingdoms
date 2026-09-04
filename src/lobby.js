import { gameState } from './state.js';
import { mapManager } from './mapManager.js';
import { showToast } from './ui.js';

// Cores Warcraft RTS clássicas
export const LOBBY_COLORS = [
    { name: 'Vermelho', hex: '#ef4444' },
    { name: 'Azul', hex: '#3b82f6' },
    { name: 'Verde', hex: '#10b981' },
    { name: 'Âmbar/Amarelo', hex: '#f59e0b' },
    { name: 'Roxo', hex: '#a855f7' },
    { name: 'Laranja', hex: '#ea580c' },
    { name: 'Ciano', hex: '#06b6d4' },
    { name: 'Cinza', hex: '#64748b' }
];

export const RACES = [
    { id: 'HUMAN', name: 'Humano' },
    { id: 'ORC', name: 'Orc' },
    { id: 'RANDOM', name: 'Aleatório' }
];

export class LobbyController {
    constructor() {
        this.selectedMapData = null;
        this.broadcastChannel = typeof BroadcastChannel === 'function'
            ? new BroadcastChannel('kingdom-wars-matchmaking')
            : null;
        this.clientId = (typeof window !== 'undefined' && window.multiplayerClientId)
            ? window.multiplayerClientId
            : Math.random().toString(36).slice(2, 10);
        this.playerName = 'Jogador';
        this.setupBroadcastListeners();
    }

    setPlayerName(name) {
        if (name && name.trim()) {
            this.playerName = name.trim();
        }
    }

    /**
     * Alterna a visibilidade das telas de acordo com o estado
     * (MAIN_MENU, MENU_MULTIPLAYER_SELECT, LOBBY_ROOM, GAME)
     */
    switchScreen(targetScreen) {
        gameState.currentMenuScreen = targetScreen;

        const startScreen = document.getElementById('startScreen');
        const multiplayerBrowser = document.getElementById('multiplayerBrowser');
        const singleMapSelection = document.getElementById('mapSelection');
        const createGameScreen = document.getElementById('multiplayerCreateGameScreen');
        const lobbyRoomScreen = document.getElementById('multiplayerLobbyRoomScreen');

        if (startScreen) startScreen.style.display = (targetScreen === 'MAIN_MENU') ? 'flex' : 'none';
        if (multiplayerBrowser) multiplayerBrowser.classList.toggle('visible', targetScreen === 'MULTIPLAYER_BROWSER');
        if (singleMapSelection) singleMapSelection.classList.toggle('visible', targetScreen === 'SINGLE_MAP_SELECT');
        if (createGameScreen) createGameScreen.classList.toggle('visible', targetScreen === 'MENU_MULTIPLAYER_SELECT');
        if (lobbyRoomScreen) lobbyRoomScreen.classList.toggle('visible', targetScreen === 'LOBBY_ROOM');
    }

    /**
     * Abre a tela de Criar Jogo (MENU_MULTIPLAYER_SELECT)
     */
    async openCreateGame() {
        this.switchScreen('MENU_MULTIPLAYER_SELECT');
        await this.populateCreateGameMaps();
    }

    /**
     * Preenche a lista de mapas na tela de Criar Jogo
     */
    async populateCreateGameMaps() {
        const listEl = document.getElementById('mpCreateMapList');
        const countBadge = document.getElementById('mpCreateMapCount');
        const nameInput = document.getElementById('mpCreateGameNameInput');

        if (!listEl) return;

        if (nameInput && (!nameInput.value || nameInput.value.trim() === '')) {
            const randNum = Math.floor(10 + Math.random() * 90);
            nameInput.value = 'Partida dos Bravos #' + randNum;
        }

        if (countBadge) countBadge.textContent = 'Buscando mapas...';
        listEl.innerHTML = '<div style="color: #a89070; padding: 16px; text-align: center;">Carregando arquivos de /maps...</div>';

        const maps = await mapManager.scanMaps();
        listEl.innerHTML = '';
        if (countBadge) countBadge.textContent = maps.length + (maps.length !== 1 ? ' mapas' : ' mapa');

        if (maps.length === 0) {
            listEl.innerHTML = '<div style=color: #a89070; padding: 16px; text-align: center;>Nenhum mapa encontrado em /maps.</div>';
            return;
        }

        maps.forEach((m) => {
            const row = document.createElement('div');
            row.className = 'wc3-file-row' + (m.corrupted ? ' corrupted' : '');
            row.dataset.mapId = m.id;

            let icon = '🌲';
            if (m.corrupted) icon = '⚠️';
            else if (m.tileset === 'deserto') icon = '🏜️';
            else if (m.tileset === 'pantano') icon = '🌫️';
            else if (m.tileset === 'bosque') icon = '🍂';

            row.innerHTML = 
                '<span class="wc3-file-icon">' + icon + '</span>' +
                '<span class="wc3-file-name">' + this.escapeHtml(m.name) + '</span>' +
                '<span class="wc3-file-players">' + this.escapeHtml(m.players || '') + '</span>';

            row.addEventListener('click', () => {
                this.selectCreateGameMap(m);
            });

            listEl.appendChild(row);
        });

        // Selecionar o primeiro mapa válido
        const firstValid = maps.find(m => !m.corrupted) || maps[0];
        if (firstValid) {
            this.selectCreateGameMap(firstValid);
        }
    }

    /**
     * Atualiza o painel direito na tela de Criar Jogo
     */
    selectCreateGameMap(mapItem) {
        this.selectedMapData = mapItem;

        document.querySelectorAll('#mpCreateMapList .wc3-file-row').forEach(row => {
            row.classList.toggle('selected', row.dataset.mapId === mapItem.id);
        });

        // Atualizar painel direito de preview
        const headerTitle = document.getElementById('mpCreateRightMapTitle');
        const headerAuthor = document.getElementById('mpCreateRightAuthor');
        const descEl = document.getElementById('mpCreateRightDesc');
        const playersEl = document.getElementById('mpCreateRightPlayers');
        const sizeEl = document.getElementById('mpCreateRightSize');
        const canvas = document.getElementById('mpCreateMapPreviewCanvas');

        if (headerTitle) headerTitle.textContent = mapItem.name || 'Sem Nome';
        if (headerAuthor) headerAuthor.textContent = 'Criado por: ' + (mapItem.author || 'Desconhecido');
        if (playersEl) playersEl.textContent = mapItem.players || ((mapItem.suggestedPlayers || 2) + ' Jogadores');
        if (sizeEl) sizeEl.textContent = mapItem.size || '80 x 80';
        if (descEl) descEl.textContent = mapItem.corrupted ? ('Erro: ' + (mapItem.error || 'Não pôde ser lido')) : (mapItem.description || 'Sem descrição');

        if (canvas) {
            mapManager.renderPreview(canvas, mapItem);
        }

        const createBtn = document.getElementById('mpConfirmCreateGameBtn');
        if (createBtn) {
            createBtn.disabled = !!mapItem.corrupted;
            createBtn.style.opacity = mapItem.corrupted ? '0.4' : '1';
        }
    }

    /**
     * Executa a criação da sala e avança para a Sala de Espera (LOBBY_ROOM)
     */
    proceedToLobby() {
        const nameInput = document.getElementById('mpCreateGameNameInput');
        const gameName = (nameInput?.value.trim()) || 'Partida dos Bravos';

        if (!this.selectedMapData || this.selectedMapData.corrupted) {
            showToast('Selecione um mapa válido para criar o jogo!');
            return;
        }

        const maxSlots = 4; // Garantir suporte completo a 4 vagas por padrão no lobby
        const slots = [];
        const defaultColors = [
            '#3b82f6', // Slot 0: Azul
            '#ef4444', // Slot 1: Vermelho
            '#10b981', // Slot 2: Verde
            '#f59e0b'  // Slot 3: Âmbar
        ];

        // Slot 0: O Anfitrião (Host)
        slots.push({
            id: 0,
            type: 'PLAYER', // PLAYER, OPEN, CLOSED, COMPUTER
            name: this.playerName,
            isHost: true,
            race: 'HUMAN',
            color: defaultColors[0],
            team: 1,
            handicap: '100%',
            difficulty: 'MEDIUM'
        });

        // Slots adicionais de acordo com a capacidade do mapa
        for (let i = 1; i < maxSlots; i++) {
            slots.push({
                id: i,
                type: 'OPEN', // Aberto por padrão
                name: 'Espaço Aberto',
                isHost: false,
                race: 'RANDOM',
                color: defaultColors[i % defaultColors.length],
                team: (i % 2 === 0) ? 1 : 2,
                handicap: '100%',
                difficulty: 'MEDIUM'
            });
        }

        gameState.multiplayerLobby = {
            gameName,
            isHost: true,
            hostName: this.playerName,
            mapData: this.selectedMapData,
            gameSpeed: 'FAST',
            gameVisibility: 'DEFAULT',
            slots,
            chatMessages: [
                { sender: 'Sistema', text: 'Você criou a sala "' + gameName + '".', color: '#ffd700' },
                { sender: 'Sistema', text: 'Mapa selecionado: ' + this.selectedMapData.name + '.', color: '#ffd700' },
                { sender: 'Sistema', text: 'Pressione Enter para enviar mensagens no bate-papo.', color: '#9ca3af' }
            ]
        };

        this.switchScreen('LOBBY_ROOM');
        this.renderLobbyUI();
        this.startHeartbeat();
    }

    /**
     * Renderiza e sincroniza a Sala de Espera (Game Lobby)
     */
    renderLobbyUI() {
        const lobby = gameState.multiplayerLobby;
        if (!lobby || !lobby.mapData) return;

        // Cabeçalhos
        const titleEl = document.getElementById('lobbyRoomGameTitle');
        const hostEl = document.getElementById('lobbyRoomHostName');
        const mapTitleEl = document.getElementById('lobbyRoomRightMapTitle');
        const mapAuthorEl = document.getElementById('lobbyRoomRightAuthor');
        const mapDescEl = document.getElementById('lobbyRoomRightDesc');
        const playersBadgeEl = document.getElementById('lobbyRoomPlayersBadge');
        const canvas = document.getElementById('lobbyRoomMapPreviewCanvas');

        if (titleEl) titleEl.textContent = 'NOME DO JOGO: ' + lobby.gameName;
        if (hostEl) hostEl.textContent = 'HOST: ' + lobby.hostName;
        if (mapTitleEl) mapTitleEl.textContent = lobby.mapData.name;
        if (mapAuthorEl) mapAuthorEl.textContent = 'Criado por: ' + (lobby.mapData.author || 'Desconhecido');
        if (mapDescEl) mapDescEl.textContent = lobby.mapData.description || '';

        const activeCount = lobby.slots.filter(s => s.type === 'PLAYER' || s.type === 'COMPUTER').length;
        if (playersBadgeEl) playersBadgeEl.textContent = 'JOGADORES: ' + activeCount + '/' + lobby.slots.length;

        if (canvas) {
            mapManager.renderPreview(canvas, lobby.mapData);
        }

        // Renderizar linhas de slots
        const container = document.getElementById('lobbySlotsTableBody');
        if (container) {
            container.innerHTML = '';
            lobby.slots.forEach((slot, index) => {
                const row = document.createElement('div');
                row.className = 'wc3-slot-row' + (slot.isHost ? ' host-slot' : '');
                const isHost = !!lobby.isHost;
                const isMySlot = slot.isHost ? isHost : (isHost ? false : (lobby.mySlotId === slot.id));
                const canEditThisSlot = isHost || isMySlot;

                // Dropdown ou texto de estado do slot
                let playerColHtml = '';
                if (slot.isHost) {
                    playerColHtml = '<div class="wc3-slot-user">' +
                        '<span class="wc3-host-crown" title="Anfitrião">👑</span>' +
                        '<strong>' + this.escapeHtml(slot.name) + '</strong>' +
                        (isHost ? ' <small style="color:#ffd700;">(Você)</small>' : '') +
                        '</div>';
                } else if (slot.type === 'PLAYER') {
                    playerColHtml = '<div class="wc3-slot-user">' +
                        '<span>👤</span> ' +
                        '<strong>' + this.escapeHtml(slot.name) + '</strong>' +
                        (isMySlot ? ' <small style="color:#60a5fa;">(Você)</small>' : '') +
                        '</div>';
                } else {
                    let diffSelectHtml = '';
                    if (slot.type === 'COMPUTER') {
                        diffSelectHtml = ' <select class="wc3-slot-select" data-slot-id="' + slot.id + '" data-field="difficulty" ' + (!isHost ? 'disabled' : '') + ' style="margin-left: 4px; font-size: 10px;">' +
                            '<option value="EASY" ' + (slot.difficulty === 'EASY' ? 'selected' : '') + '>Fácil</option>' +
                            '<option value="MEDIUM" ' + (slot.difficulty === 'MEDIUM' || !slot.difficulty ? 'selected' : '') + '>Médio</option>' +
                            '<option value="HARD" ' + (slot.difficulty === 'HARD' ? 'selected' : '') + '>Difícil</option>' +
                            '</select>';
                    }
                    playerColHtml = '<div class="wc3-slot-user">' +
                        '<select class="wc3-slot-select" data-slot-id="' + slot.id + '" data-field="type" ' + (!isHost ? 'disabled' : '') + '>' +
                        '<option value="OPEN" ' + (slot.type === 'OPEN' ? 'selected' : '') + '>Aberto</option>' +
                        '<option value="COMPUTER" ' + (slot.type === 'COMPUTER' ? 'selected' : '') + '>Computador (IA)</option>' +
                        '<option value="CLOSED" ' + (slot.type === 'CLOSED' ? 'selected' : '') + '>Fechado</option>' +
                        '</select>' +
                        '<span class="wc3-slot-status-name">' + this.escapeHtml(slot.name) + '</span>' +
                        diffSelectHtml +
                        '</div>';
                }

                // Dropdown de Raça
                const raceOptions = RACES.map(r => '<option value="' + r.id + '" ' + (slot.race === r.id ? 'selected' : '') + '>' + r.name + '</option>').join('');
                const raceColHtml = '<select class="wc3-slot-select" data-slot-id="' + slot.id + '" data-field="race" ' + (!canEditThisSlot || slot.type === 'CLOSED' || slot.type === 'OPEN' ? 'disabled' : '') + '>' +
                    raceOptions +
                    '</select>';

                // Seletor de Cor (desabilitar cores já em uso por outros slots)
                const usedColors = new Set(
                    lobby.slots
                        .filter(s => s.id !== slot.id && s.type !== 'CLOSED' && s.type !== 'OPEN')
                        .map(s => s.color)
                );

                const colorOptions = LOBBY_COLORS.map(c => {
                    const isSelected = slot.color === c.hex;
                    const isTaken = usedColors.has(c.hex) && !isSelected;
                    const disabledAttr = isTaken ? 'disabled' : '';
                    const label = c.name + (isTaken ? ' (Em uso)' : '');
                    return '<option value="' + c.hex + '" ' + (isSelected ? 'selected' : '') + ' ' + disabledAttr + ' style="background: ' + c.hex + '; color: #fff;">' + label + '</option>';
                }).join('');

                const colorColHtml = '<div class="wc3-color-picker-wrap">' +
                    '<span class="wc3-color-swatch" style="background-color: ' + slot.color + ';"></span>' +
                    '<select class="wc3-slot-select wc3-color-select" data-slot-id="' + slot.id + '" data-field="color" ' + (!canEditThisSlot || slot.type === 'CLOSED' || slot.type === 'OPEN' ? 'disabled' : '') + '>' +
                    colorOptions +
                    '</select>' +
                    '</div>';

                // Seletor de Equipe
                const teamOptions = [1, 2, 3, 4].map(t => '<option value="' + t + '" ' + (slot.team === t ? 'selected' : '') + '>Time ' + t + '</option>').join('');
                const teamColHtml = '<select class="wc3-slot-select" data-slot-id="' + slot.id + '" data-field="team" ' + (!canEditThisSlot || slot.type === 'CLOSED' || slot.type === 'OPEN' ? 'disabled' : '') + '>' +
                    teamOptions +
                    '</select>';

                row.innerHTML = '<div class="wc3-slot-col col-idx">' + (index + 1) + '</div>' +
                    '<div class="wc3-slot-col col-player">' + playerColHtml + '</div>' +
                    '<div class="wc3-slot-col col-race">' + raceColHtml + '</div>' +
                    '<div class="wc3-slot-col col-color">' + colorColHtml + '</div>' +
                    '<div class="wc3-slot-col col-team">' + teamColHtml + '</div>';

                // Listeners de alteração do slot
                row.querySelectorAll('.wc3-slot-select').forEach(sel => {
                    sel.addEventListener('change', (e) => {
                        const field = e.target.dataset.field;
                        const val = e.target.value;
                        this.updateSlotField(slot.id, field, val);
                    });
                });

                container.appendChild(row);
            });
        }

        // Atualizar estado do botão Iniciar Jogo (apenas Host pode clicar)
        const startBtn = document.getElementById('lobbyStartMatchBtn');
        if (startBtn) {
            if (!lobby.isHost) {
                startBtn.disabled = true;
                startBtn.textContent = 'AGUARDANDO HOST...';
                startBtn.title = 'Apenas o anfitrião pode dar início à partida.';
            } else {
                startBtn.disabled = false;
                startBtn.textContent = 'COMEÇAR JOGO';
                startBtn.title = '';
            }
        }

        // Renderizar Chat
        this.renderChatMessages();
    }

    updateSlotField(slotId, field, value) {
        const lobby = gameState.multiplayerLobby;
        if (!lobby) return;

        // Se for cliente tentando mudar o próprio slot, envia requisição ao host
        if (!lobby.isHost) {
            if (this.broadcastChannel) {
                this.broadcastChannel.postMessage({
                    type: 'lobby_slot_change_request',
                    slotId,
                    field,
                    value,
                    senderClientId: this.clientId
                });
            }
            return;
        }

        const slot = lobby.slots.find(s => s.id === slotId);
        if (!slot) return;

        if (field === 'type') {
            slot.type = value;
            if (value === 'COMPUTER') {
                slot.name = 'Computador (IA)';
                slot.race = 'ORC';
            } else if (value === 'CLOSED') {
                slot.name = 'Fechado';
            } else {
                slot.name = 'Espaço Aberto';
            }
        } else if (field === 'team') {
            slot.team = parseInt(value, 10);
        } else if (field === 'color') {
            // Se outro slot ativo já possui esta cor, trocamos as cores entre eles
            const oldColor = slot.color;
            const otherSlot = lobby.slots.find(s => s.id !== slotId && s.color === value);
            if (otherSlot) {
                otherSlot.color = oldColor;
            }
            slot.color = value;
        } else if (field === 'race' || field === 'difficulty') {
            slot[field] = value;
        }

        this.renderLobbyUI();
        this.broadcastLobbyUpdate();
    }

    renderChatMessages() {
        const chatBox = document.getElementById('lobbyChatMessages');
        if (!chatBox) return;

        chatBox.innerHTML = '';
        const msgs = gameState.multiplayerLobby.chatMessages || [];
        msgs.forEach(msg => {
            const p = document.createElement('div');
            p.className = 'wc3-chat-line';
            p.innerHTML = '<span class="wc3-chat-sender" style="color: ' + (msg.color || '#3b82f6') + ';">' + this.escapeHtml(msg.sender) + ':</span> <span class="wc3-chat-text">' + this.escapeHtml(msg.text) + '</span>';
            chatBox.appendChild(p);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    sendChatMessage(text) {
        if (!text || !text.trim()) return;
        const msgObj = {
            sender: this.playerName,
            text: text.trim(),
            color: '#3b82f6'
        };
        gameState.multiplayerLobby.chatMessages.push(msgObj);
        this.renderChatMessages();

        if (this.broadcastChannel) {
            this.broadcastChannel.postMessage({
                type: 'lobby_chat',
                roomName: gameState.multiplayerLobby.gameName,
                msg: msgObj
            });
        }
    }

    setupBroadcastListeners() {
        if (!this.broadcastChannel) return;
        this.broadcastChannel.addEventListener('message', (e) => {
            const data = e.data;
            if (!data) return;

            // 1. Alguém consultou as salas disponíveis (query_rooms)
            if (data.type === 'query_rooms') {
                if (gameState.multiplayerLobby?.isHost && gameState.currentMenuScreen === 'LOBBY_ROOM') {
                    this.broadcastLobbyPresence(data.sentAt);
                }
            }

            // 2. Um jogador quer entrar na sala do Host (join_request)
            else if (data.type === 'join_request') {
                const lobby = gameState.multiplayerLobby;
                if (!lobby?.isHost || gameState.currentMenuScreen !== 'LOBBY_ROOM') return;
                if (data.roomId !== 'room_' + this.clientId) return;

                // Procurar primeira vaga aberta
                const openSlot = lobby.slots.find(s => s.type === 'OPEN');
                if (!openSlot) {
                    this.broadcastChannel.postMessage({
                        type: 'join_rejected',
                        targetClientId: data.joinerClientId,
                        reason: 'A sala está cheia!'
                    });
                    return;
                }

                // Ocupar slot com o jogador remoto
                openSlot.type = 'PLAYER';
                openSlot.name = data.playerName || ('Jogador ' + (openSlot.id + 1));
                openSlot.clientId = data.joinerClientId;

                const joinMsg = {
                    sender: 'Sistema',
                    text: `${openSlot.name} entrou na sala!`,
                    color: '#ffd700'
                };
                lobby.chatMessages.push(joinMsg);

                // Responder aceitando e enviando o estado completo da sala
                this.broadcastChannel.postMessage({
                    type: 'join_accepted',
                    targetClientId: data.joinerClientId,
                    roomId: data.roomId,
                    slotId: openSlot.id,
                    lobbyState: {
                        gameName: lobby.gameName,
                        hostName: lobby.hostName,
                        mapData: lobby.mapData,
                        gameSpeed: lobby.gameSpeed,
                        gameVisibility: lobby.gameVisibility,
                        slots: lobby.slots,
                        chatMessages: lobby.chatMessages
                    }
                });

                this.renderLobbyUI();
                this.broadcastLobbyUpdate();
                showToast(`⚔️ ${openSlot.name} ingressou na sala!`);
            }

            // 3. Resposta de aceitação de entrada para o cliente (join_accepted)
            else if (data.type === 'join_accepted') {
                if (data.targetClientId !== this.clientId) return;

                const incomingLobby = data.lobbyState;
                if (!incomingLobby) return;

                gameState.multiplayerLobby = {
                    ...incomingLobby,
                    isHost: false,
                    mySlotId: data.slotId
                };

                this.switchScreen('LOBBY_ROOM');
                this.renderLobbyUI();
                showToast(`⚔️ Conectado à sala "${incomingLobby.gameName}"!`);
            }

            // 4. Jogador cliente saiu da sala
            else if (data.type === 'lobby_client_leave') {
                const lobby = gameState.multiplayerLobby;
                if (lobby?.isHost && gameState.currentMenuScreen === 'LOBBY_ROOM') {
                    const slot = lobby.slots.find(s => s.clientId === data.senderClientId);
                    if (slot) {
                        const leaverName = slot.name;
                        slot.type = 'OPEN';
                        slot.name = 'Espaço Aberto';
                        slot.clientId = null;

                        lobby.chatMessages.push({
                            sender: 'Sistema',
                            text: `${leaverName} saiu da sala.`,
                            color: '#ef4444'
                        });

                        this.renderLobbyUI();
                        this.broadcastLobbyUpdate();
                        showToast(`${leaverName} saiu da sala.`);
                    }
                }
            }

            // 5. Requisição de mudança de slot enviada por um cliente ao Host
            else if (data.type === 'lobby_slot_change_request') {
                const lobby = gameState.multiplayerLobby;
                if (lobby?.isHost && gameState.currentMenuScreen === 'LOBBY_ROOM') {
                    const slot = lobby.slots.find(s => s.id === data.slotId && s.clientId === data.senderClientId);
                    if (slot && (data.field === 'race' || data.field === 'color' || data.field === 'team')) {
                        if (data.field === 'team') {
                            slot.team = parseInt(data.value, 10);
                        } else if (data.field === 'color') {
                            const oldColor = slot.color;
                            const otherSlot = lobby.slots.find(s => s.id !== slot.id && s.color === data.value);
                            if (otherSlot) {
                                otherSlot.color = oldColor;
                            }
                            slot.color = data.value;
                        } else if (data.field === 'race') {
                            slot.race = data.value;
                        }
                        this.renderLobbyUI();
                        this.broadcastLobbyUpdate();
                    }
                }
            }

            // 6. Mensagens de chat do lobby
            else if (data.type === 'lobby_chat' && gameState.currentMenuScreen === 'LOBBY_ROOM') {
                if (data.msg && data.msg.sender !== this.playerName) {
                    gameState.multiplayerLobby.chatMessages.push(data.msg);
                    this.renderChatMessages();
                }
            }

            // 6. Atualização de slots transmitida pelo Host
            else if (data.type === 'lobby_slots_update' && gameState.currentMenuScreen === 'LOBBY_ROOM' && !gameState.multiplayerLobby?.isHost) {
                if (data.slots && gameState.multiplayerLobby) {
                    gameState.multiplayerLobby.slots = data.slots;
                    this.renderLobbyUI();
                }
            }
        });
    }

    broadcastLobbyPresence(querySentAt = null) {
        if (!this.broadcastChannel || !gameState.multiplayerLobby) return;
        const lobby = gameState.multiplayerLobby;
        const activePlayers = lobby.slots ? lobby.slots.filter(s => s.type === 'PLAYER').length : 1;
        const totalSlots = lobby.slots ? lobby.slots.length : 4;

        const roomObj = {
            id: 'room_' + this.clientId,
            name: lobby.gameName,
            isPrivate: false,
            hasPassword: false,
            mapIndex: lobby.mapData?.mapIndex ?? 0,
            mapName: lobby.mapData?.name || 'Campos do Norte',
            hostClientId: this.clientId,
            players: activePlayers,
            maxPlayers: totalSlots,
            lastHeartbeat: Date.now()
        };

        // Transmitir pelo canal
        this.broadcastChannel.postMessage({
            type: 'room_announce',
            room: roomObj,
            querySentAt,
            hostClientId: this.clientId
        });

        // Gravar também no localStorage para compatibilidade imediata
        try {
            const raw = localStorage.getItem('kingdom_wars_rooms_v1');
            const rooms = raw ? JSON.parse(raw) : {};
            rooms[roomObj.id] = roomObj;
            localStorage.setItem('kingdom_wars_rooms_v1', JSON.stringify(rooms));
        } catch (e) { }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.broadcastLobbyPresence();
        this._heartbeatInterval = setInterval(() => {
            if (gameState.multiplayerLobby?.isHost && gameState.currentMenuScreen === 'LOBBY_ROOM') {
                this.broadcastLobbyPresence();
            } else {
                this.stopHeartbeat();
            }
        }, 1500);
    }

    stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
        // Remover do localStorage ao parar
        try {
            const raw = localStorage.getItem('kingdom_wars_rooms_v1');
            if (raw) {
                const rooms = JSON.parse(raw);
                delete rooms['room_' + this.clientId];
                localStorage.setItem('kingdom_wars_rooms_v1', JSON.stringify(rooms));
            }
        } catch (e) { }
    }

    broadcastLobbyUpdate() {
        this.broadcastLobbyPresence();
        if (this.broadcastChannel && gameState.multiplayerLobby) {
            this.broadcastChannel.postMessage({
                type: 'lobby_slots_update',
                slots: gameState.multiplayerLobby.slots
            });
        }
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[m]));
    }
}

export const lobbyController = new LobbyController();
