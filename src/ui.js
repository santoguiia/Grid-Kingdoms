import { CONFIG } from './config.js';
import { gameState } from './state.js';
import { Unit, getStandPositionNearBuilding } from './entities.js';
import { UNIT_DEFS, BUILDING_DEFS, TECHNOLOGY_DEFS } from './data.js';
import { broadcastNetAction } from './network.js';

let lastCommandStateKey = '';
let lastUnitInfoStateKey = '';
let activeSubgroupFilter = 'ALL';

// Funções de auxílio e status
// ============================================================
function getUnitStatusInfo(unit) {
    if (unit.repairTarget && unit.repairTarget.health > 0 && unit.repairTarget.health < unit.repairTarget.maxHealth) {
        const b = unit.repairTarget;
        const hpPct = Math.round((b.health / b.maxHealth) * 100);
        return {
            icon: '🔧',
            label: 'Reparando',
            detail: `Consertando ${b.name} (${hpPct}%)`,
            badgeClass: 'status-build'
        };
    }
    if (unit.buildingTarget && unit.buildingTarget.health > 0 && !unit.buildingTarget.isConstructed) {
        const b = unit.buildingTarget;
        const progressPct = Math.round((b.buildProgress / b.buildTime) * 100);
        return {
            icon: '🔨',
            label: 'Construindo',
            detail: `Erguendo ${b.name} (${progressPct}%)`,
            badgeClass: 'status-build'
        };
    }
    if (unit.attackTarget && unit.attackTarget.health > 0) {
        return {
            icon: '⚔️',
            label: 'Combate',
            detail: `Atacando ${unit.attackTarget.name || 'inimigo'}`,
            badgeClass: 'status-combat'
        };
    }
    if (unit.returning && unit.gatherAmount > 0) {
        const resName = unit.gatherType === 'gold' ? 'Ouro' : 'Madeira';
        const resIcon = unit.gatherType === 'gold' ? '🪙' : '🪵';
        return {
            icon: '📦',
            label: `Retornando (${resName})`,
            detail: `Entregando ${unit.gatherAmount}x ${resIcon} no Town Hall`,
            badgeClass: 'status-deliver'
        };
    }
    if (unit.gathering) {
        const isGold = unit.gatherType === 'gold';
        return {
            icon: isGold ? '⛏️' : '🪓',
            label: isGold ? 'Minerando Ouro' : 'Cortando Madeira',
            detail: isGold ? 'Extraindo do filão de ouro (grid 3x3)' : 'Extraindo madeira florestal',
            badgeClass: 'status-gather'
        };
    }
    if (unit.targetX !== null && unit.targetY !== null) {
        return {
            icon: '🚶',
            label: 'Marchando',
            detail: 'Movendo-se para destino',
            badgeClass: 'status-move'
        };
    }
    if (unit.canGather) {
        return {
            icon: '💤',
            label: 'Aldeão ocioso',
            detail: 'Aguardando uma tarefa',
            badgeClass: 'status-idle'
        };
    }
    return {
        icon: '🛡️',
        label: 'Aguardando',
        detail: 'Em posição de guarda',
        badgeClass: 'status-idle'
    };
}

function getHealthColor(percent) {
    if (percent > 0.5) return '#2ecc71';
    if (percent > 0.25) return '#f39c12';
    return '#e74c3c';
}

// Ações de comando de grupo
// ============================================================
export function stopSelectedUnits() {
    if (!gameState.selectedUnits || gameState.selectedUnits.length === 0) return;
    for (const u of gameState.selectedUnits) {
        u.targetX = null;
        u.targetY = null;
        u.attackTarget = null;
        u.gathering = false;
        u.autoGathering = false;
        u.returning = false;
        u.clusterOrigin = null;
        u.gatherType = null;
        u.gatherTargetTile = null;
        u.buildingTarget = null;
        u.isBuilding = false;
        u.repairTarget = null;
        u.isRepairing = false;
    }
    broadcastNetAction({
        type: 'stop_units',
        role: gameState.myRole || 'player',
        unitIds: gameState.selectedUnits.map(u => u.id)
    });
    showToast(`🛑 ${gameState.selectedUnits.length} unidade(s) paradas.`);
}

export function focusCameraOnSelection() {
    if (gameState.selectedUnits.length === 0) {
        if (gameState.selectedBuilding) {
            gameState.camera.x = (gameState.selectedBuilding.x + gameState.selectedBuilding.width / 2) * CONFIG.TILE_SIZE;
            gameState.camera.y = (gameState.selectedBuilding.y + gameState.selectedBuilding.height / 2) * CONFIG.TILE_SIZE;
        }
        return;
    }
    const avgX = gameState.selectedUnits.reduce((acc, u) => acc + u.x, 0) / gameState.selectedUnits.length;
    const avgY = gameState.selectedUnits.reduce((acc, u) => acc + u.y, 0) / gameState.selectedUnits.length;
    gameState.camera.x = avgX;
    gameState.camera.y = avgY;
}

export function deselectUnit(unitId) {
    const idx = gameState.selectedUnits.findIndex(u => u.id === unitId);
    if (idx !== -1) {
        const removed = gameState.selectedUnits.splice(idx, 1)[0];
        if (gameState.hoveredUnitId === unitId) {
            gameState.hoveredUnitId = null;
        }
        lastUnitInfoStateKey = '';
        lastCommandStateKey = '';
        if (removed) {
            showToast(`Deselecionado: ${removed.name}`);
        }
    }
}

export function selectOnlyUnit(unitId) {
    const unit = gameState.selectedUnits.find(u => u.id === unitId) || gameState.units.find(u => u.id === unitId);
    if (unit) {
        gameState.selectedUnits = [unit];
        gameState.selectedBuilding = null;
        lastUnitInfoStateKey = '';
        lastCommandStateKey = '';
        showToast(`Selecionado: ${unit.icon} ${unit.name}`);
    }
}

export function filterSelectionByType(typeName) {
    if (!typeName || typeName === 'ALL') {
        activeSubgroupFilter = 'ALL';
        return;
    }
    activeSubgroupFilter = typeName;
    gameState.selectedUnits = gameState.selectedUnits.filter(u => u.name === typeName);
    lastUnitInfoStateKey = '';
    lastCommandStateKey = '';
    showToast(`⚔️ Seleção refinada: ${typeName} (${gameState.selectedUnits.length})`);
}

// UI Loop Principal
// ============================================================
function updateUI() {
    const goldEl = document.getElementById('goldValue');
    const woodEl = document.getElementById('woodValue');
    const foodEl = document.getElementById('foodValue');

    const myResources = (gameState.myRole === 'enemy') ? gameState.enemyResources : gameState.resources;

    if (goldEl) goldEl.textContent = Math.floor(myResources.gold);
    if (woodEl) woodEl.textContent = Math.floor(myResources.wood);
    if (foodEl) foodEl.textContent = `${myResources.foodUsed}/${myResources.foodMax}`;

    updateHeroWidget();
    updateCommandPanel();
    updateUnitInfo();
}

let heroWidgetSetup = false;
function updateHeroWidget() {
    const widget = document.getElementById('heroWidget');
    if (!widget) return;

    if (!heroWidgetSetup) {
        heroWidgetSetup = true;
        widget.addEventListener('click', () => {
            if (gameState.hero && gameState.hero.health > 0) {
                gameState.camera.x = gameState.hero.x;
                gameState.camera.y = gameState.hero.y;
                gameState.selectedUnits = [gameState.hero];
                gameState.selectedBuilding = null;
                showToast('👑 Câmera focada no Herói!');
            } else if (gameState.heroDead) {
                showToast('💀 Seu herói está caído! Reviva-o no Altar dos Reis.');
            }
        });
    }

    if (!gameState.hero && !gameState.heroDead) {
        widget.classList.add('hidden');
        return;
    }

    widget.classList.remove('hidden');
    const lvlEl = document.getElementById('heroLevelBadge');
    const hpBar = document.getElementById('heroHpBar');
    const xpBar = document.getElementById('heroXpBar');
    const hpText = document.getElementById('heroHpText');
    const xpText = document.getElementById('heroXpText');

    if (lvlEl) lvlEl.textContent = gameState.heroLevel || 1;

    if (gameState.heroDead) {
        if (hpBar) hpBar.style.width = '0%';
        if (hpText) hpText.textContent = 'Caído (Altar)';
        if (xpBar) xpBar.style.width = `${Math.min(100, Math.round((gameState.heroXP / gameState.heroMaxXP) * 100))}%`;
        if (xpText) xpText.textContent = `${gameState.heroXP}/${gameState.heroMaxXP} XP`;
        return;
    }

    const hero = gameState.hero;
    const hpRatio = Math.max(0, Math.min(1, hero.health / hero.maxHealth));
    const xpRatio = Math.max(0, Math.min(1, gameState.heroXP / gameState.heroMaxXP));

    if (hpBar) hpBar.style.width = `${Math.round(hpRatio * 100)}%`;
    if (xpBar) xpBar.style.width = `${Math.round(xpRatio * 100)}%`;
    if (hpText) hpText.textContent = `${Math.ceil(hero.health)}/${hero.maxHealth} HP`;
    if (xpText) xpText.textContent = `${gameState.heroXP}/${gameState.heroMaxXP} XP`;
}

function trainUnit(building, unitType) {
    const def = UNIT_DEFS[unitType];
    if (!def) return;

    const costG = def.costGold || (unitType === 'SOLDIER' ? 100 : unitType === 'PEASANT' ? 50 : 75);
    const costW = def.costWood || (unitType === 'SOLDIER' ? 50 : unitType === 'PEASANT' ? 25 : 40);

    if (def.isHero) {
        if (gameState.hero && gameState.hero.health > 0) {
            showToast('Você já possui um Herói vivo em campo!');
            return;
        }
        if (gameState.heroDead) {
            // Ressurreição mantém nível
            showToast(`👑 Ressuscitando Herói (Nível ${gameState.heroLevel})...`);
        }
    }

    const myResources = (gameState.myRole === 'enemy') ? gameState.enemyResources : gameState.resources;

    if (myResources.gold < costG || myResources.wood < costW) {
        showToast('Recursos insuficientes para treinar!');
        return;
    }
    if (myResources.foodUsed >= myResources.foodMax) {
        showToast('Limite de população atingido! Construa mais Casas.');
        return;
    }

    myResources.gold -= costG;
    myResources.wood -= costW;
    myResources.foodUsed += 1;

    // Adicionar à fila de produção do edifício
    const unitId = 'unit_' + Math.random().toString(36).substr(2, 9);
    building.queueUnit(unitType, unitId);

    broadcastNetAction({
        type: 'train_unit',
        role: gameState.myRole || 'player',
        buildingId: building.id,
        unitType,
        unitId
    });

    const queuePos = building.trainQueue.length;
    const timeSec = Math.round((def.trainTime || 180) / 60);
    showToast(`${def.icon} ${def.name} em produção (${timeSec}s)${queuePos > 1 ? ` - Fila #${queuePos}` : ''}!`);
}

function updateCommandPanel() {
    const panel = document.getElementById('commandPanel');
    if (!panel) return;

    const hasPeasantSelected = gameState.selectedUnits.some(u => u.canGather);
    const gold = Math.floor(gameState.resources.gold);
    const wood = Math.floor(gameState.resources.wood);
    const foodFree = gameState.resources.foodUsed < gameState.resources.foodMax;
    const buildingId = gameState.selectedBuilding ? `${gameState.selectedBuilding.id}_${gameState.selectedBuilding.isConstructed}_${Math.floor(gameState.selectedBuilding.buildProgress || 0)}` : 'none';
    const selCount = gameState.selectedUnits.length;
    const mode = gameState.buildingMode || 'none';

    const researchState = gameState.activeResearch ? `${gameState.activeResearch.id}_${gameState.activeResearch.remaining}` : 'none';
    const stateKey = `${buildingId}_${selCount}_${hasPeasantSelected}_${mode}_age${gameState.age}_${researchState}_${gold >= 25}_${gold >= 50}_${gold >= 100}_${gold >= 125}_${gold >= 150}_${wood >= 25}_${wood >= 50}_${wood >= 75}_${wood >= 100}_${foodFree}`;

    if (lastCommandStateKey === stateKey) return;
    lastCommandStateKey = stateKey;

    panel.innerHTML = '';

    if (gameState.selectedBuilding) {
        const building = gameState.selectedBuilding;
        const myRole = gameState.myRole || 'player';
        if (building.owner !== myRole) return;

        if (!building.isConstructed) {
            const pct = Math.round((building.buildProgress / building.buildTime) * 100);
            const notice = document.createElement('div');
            notice.style.cssText = 'grid-column: 1 / -1; background: rgba(245, 158, 11, 0.15); border: 1px dashed #f59e0b; border-radius: 6px; padding: 8px; text-align: center; color: #f59e0b; font-size: 11px;';
            notice.innerHTML = `
                <div style="font-weight:bold;margin-bottom:4px;">🔨 Canteiro de Obras (${pct}%)</div>
                <div style="color:var(--text);font-size:10px;">Clique com botão direito com um Camponês para construir.</div>
            `;
            panel.appendChild(notice);
            return;
        }

        for (const unitType of building.trains || []) {
            const def = UNIT_DEFS[unitType];
            if (!def) continue;
            const costG = def.costGold || (unitType === 'SOLDIER' ? 100 : unitType === 'PEASANT' ? 50 : 75);
            const costW = def.costWood || (unitType === 'SOLDIER' ? 50 : unitType === 'PEASANT' ? 25 : 40);
            const canAfford = gameState.resources.gold >= costG &&
                gameState.resources.wood >= costW &&
                gameState.resources.foodUsed < gameState.resources.foodMax;
            const btn = document.createElement('button');
            btn.className = 'command-btn' + (canAfford ? '' : ' disabled');
            btn.title = `${def.name}: ${costG} ouro, ${costW} madeira`;
            btn.innerHTML = `<span class="icon">${def.icon}</span><span style="font-size:9px">${def.name}</span><span class="cost">🪙${costG} 🪵${costW}</span>`;
            btn.onclick = () => {
                if (canAfford) {
                    trainUnit(building, unitType);
                } else if (gameState.resources.foodUsed >= gameState.resources.foodMax) {
                    showToast('Limite de população! Construa mais Casas.');
                } else {
                    showToast('Recursos insuficientes!');
                }
            };
            panel.appendChild(btn);
        }
        if (building.name === 'Town Hall' && gameState.age < CONFIG.MAX_AGE) {
            const ageBtn = document.createElement('button');
            const costGold = gameState.age === 1 ? CONFIG.AGE_2_COST_GOLD : CONFIG.AGE_3_COST_GOLD;
            const costWood = gameState.age === 1 ? CONFIG.AGE_2_COST_WOOD : CONFIG.AGE_3_COST_WOOD;
            const canUpgrade = gameState.resources.gold >= costGold && gameState.resources.wood >= costWood;
            ageBtn.className = `command-btn${canUpgrade ? '' : ' disabled'}`;
            ageBtn.title = `Avançar para a Era ${gameState.age + 1}`;
            ageBtn.innerHTML = `<span class="icon">⬆️</span><span>Era ${gameState.age + 1}</span><span class="cost">🪙${costGold} 🪵${costWood}</span>`;
            ageBtn.onclick = () => {
                if (!canUpgrade) {
                    showToast('Recursos insuficientes para avançar de era.');
                    return;
                }
                gameState.resources.gold -= costGold;
                gameState.resources.wood -= costWood;
                gameState.age++;
                lastCommandStateKey = '';
                showToast(`🏛️ Avançou para a Era ${gameState.age}!`);
                updateCommandPanel();
            };
            panel.appendChild(ageBtn);
        }
        if (building.name === 'Town Hall' && !gameState.activeResearch) {
            const researchTitle = document.createElement('div');
            researchTitle.style.cssText = 'grid-column:1/-1;color:var(--accent-hot);font-size:11px;margin-top:6px;';
            researchTitle.textContent = `Evoluções disponíveis (Era ${gameState.age})`;
            panel.appendChild(researchTitle);
            for (const [id, tech] of Object.entries(TECHNOLOGY_DEFS)) {
                if (gameState.researchedTechs.includes(id)) continue;
                const requiredAge = id === 'LOOM' ? 1 : 2;
                if (gameState.age < requiredAge) continue;
                const btn = document.createElement('button');
                const canAfford = gameState.resources.gold >= tech.costGold && gameState.resources.wood >= tech.costWood;
                btn.className = `command-btn${canAfford ? '' : ' disabled'}`;
                btn.title = tech.description;
                btn.innerHTML = `<span class="icon">${tech.icon}</span><span>${tech.name}</span><span class="cost">🪙${tech.costGold} 🪵${tech.costWood}</span>`;
                btn.onclick = () => {
                    if (!canAfford) {
                        showToast('Recursos insuficientes para pesquisar esta evolução.');
                        return;
                    }
                    gameState.resources.gold -= tech.costGold;
                    gameState.resources.wood -= tech.costWood;
                    gameState.activeResearch = { id, remaining: tech.researchTime };
                    lastCommandStateKey = '';
                    showToast(`${tech.icon} Pesquisando ${tech.name}...`);
                    updateCommandPanel();
                };
                panel.appendChild(btn);
            }
            const rallyBtn = document.createElement('button');
            rallyBtn.className = 'command-btn';
            rallyBtn.title = 'Definir o ponto onde novas unidades devem se reunir';
            rallyBtn.innerHTML = '<span class="icon">🚩</span><span>Ponto de reunião</span>';
            rallyBtn.onclick = () => {
                gameState.rallyMode = true;
                showToast('🚩 Clique no mapa para definir o ponto de reunião.');
            };
            panel.appendChild(rallyBtn);
        } else if (building.name === 'Town Hall' && gameState.activeResearch) {
            const tech = TECHNOLOGY_DEFS[gameState.activeResearch.id];
            const pct = Math.round((1 - gameState.activeResearch.remaining / tech.researchTime) * 100);
            const notice = document.createElement('div');
            notice.style.cssText = 'grid-column:1/-1;color:#f59e0b;font-size:11px;padding:6px;';
            notice.innerHTML = `🔬 Pesquisando ${tech.name}: ${pct}%`;
            panel.appendChild(notice);
        }
    } else if (gameState.selectedUnits.length === 0) {
        if (gameState.age < CONFIG.MAX_AGE) {
            const ageBtn = document.createElement('button');
            const costGold = gameState.age === 1 ? CONFIG.AGE_2_COST_GOLD : CONFIG.AGE_3_COST_GOLD;
            const costWood = gameState.age === 1 ? CONFIG.AGE_2_COST_WOOD : CONFIG.AGE_3_COST_WOOD;
            const canUpgrade = gameState.resources.gold >= costGold && gameState.resources.wood >= costWood;
            ageBtn.className = `command-btn${canUpgrade ? '' : ' disabled'}`;
            ageBtn.title = `Avançar para a Era ${gameState.age + 1}`;
            ageBtn.innerHTML = `<span class="icon">⬆️</span><span>Era ${gameState.age + 1}</span><span class="cost">🪙${costGold} 🪵${costWood}</span>`;
            ageBtn.onclick = () => {
                if (!canUpgrade) {
                    showToast('Recursos insuficientes para avançar de era.');
                    return;
                }
                gameState.resources.gold -= costGold;
                gameState.resources.wood -= costWood;
                gameState.age++;
                lastCommandStateKey = '';
                showToast(`🏛️ Avançou para a Era ${gameState.age}!`);
                updateCommandPanel();
            };
            panel.appendChild(ageBtn);
        }
        renderBuildingButtons(panel);
    } else {
        // Ações de comando para tropas selecionadas
        const stopBtn = document.createElement('button');
        stopBtn.className = 'command-btn';
        stopBtn.title = 'Parar todas as unidades selecionadas (Tecla S)';
        stopBtn.innerHTML = '<span class="icon">🛑</span><span>Parar</span>';
        stopBtn.onclick = () => stopSelectedUnits();
        panel.appendChild(stopBtn);

        if (hasPeasantSelected) {
            const gatherBtn = document.createElement('button');
            gatherBtn.className = 'command-btn';
            gatherBtn.title = 'Mandar peões coletarem recursos automaticamente';
            gatherBtn.innerHTML = '<span class="icon">⛏️</span><span>Coletar</span>';
            gatherBtn.onclick = () => {
                let count = 0;
                for (const u of gameState.selectedUnits) {
                    if (u.canGather) {
                        u.findResource();
                        count++;
                    }
                }
                if (count > 0) showToast(`⛏️ ${count} camponês(es) enviados para coletar.`);
            };
            panel.appendChild(gatherBtn);

            renderBuildingButtons(panel);
        }
    }
}

function renderBuildingButtons(panel) {
    const buildings = ['HOUSE', 'BARRACKS', 'ARCHERY_RANGE', 'ALTAR', 'FARM', 'TOWER', 'BLACKSMITH', 'MARKET', 'CASTLE'];

    for (const type of buildings) {
        const def = BUILDING_DEFS[type];
        if (!def) continue;
        if (def.requiredAge && gameState.age < def.requiredAge) continue;
        const btn = document.createElement('button');
        btn.className = 'command-btn';

        const costGold = def.costGold || (type === 'HOUSE' ? 100 : type === 'BARRACKS' ? 150 : type === 'ARCHERY_RANGE' ? 125 : type === 'FARM' ? 50 : type === 'WALL' ? 25 : 150);
        const costWood = def.costWood || (type === 'HOUSE' ? 50 : type === 'BARRACKS' ? 100 : type === 'ARCHERY_RANGE' ? 75 : type === 'FARM' ? 25 : type === 'WALL' ? 25 : 50);

        const myResources = (gameState.myRole === 'enemy') ? gameState.enemyResources : gameState.resources;
        const canAfford = myResources.gold >= costGold && myResources.wood >= costWood;

        if (!canAfford) btn.classList.add('disabled');
        if (gameState.buildingMode === type) btn.classList.add('active');

        btn.title = `Construir ${def.name} (${costGold} ouro, ${costWood} madeira)`;
        btn.innerHTML = `
            <span class="icon">${def.icon}</span>
            <span style="font-size:9px">${def.name}</span>
            <span class="cost">🪙${costGold} 🪵${costWood}</span>
        `;

        btn.onclick = () => {
            if (!canAfford) {
                showToast(`Recursos insuficientes para ${def.name}! Precisa de 🪙${costGold} e 🪵${costWood}.`);
                return;
            }
            if (gameState.buildingMode === type) {
                gameState.buildingMode = null;
                lastCommandStateKey = '';
                showToast('Modo de construção cancelado.');
            } else {
                gameState.buildingMode = type;
                lastCommandStateKey = '';
                showToast(`Modo Construção: ${def.icon} ${def.name}. Clique no mapa com botão esquerdo para posicionar.`);
            }
            updateCommandPanel();
        };

        panel.appendChild(btn);
    }
}

function updateUnitInfo() {
    const infoPanel = document.getElementById('unitInfo');
    if (!infoPanel) return;

    // 1. EDIFÍCIO SELECIONADO
    if (gameState.selectedBuilding) {
        infoPanel.classList.remove('multi-selection');
        const building = gameState.selectedBuilding;
        const healthPercent = Math.max(0, Math.min(100, Math.round(building.health / building.maxHealth * 100)));
        const buildPercent = Math.max(0, Math.min(100, Math.round((building.buildProgress || 0) / (building.buildTime || 1) * 100)));
        const stateKey = `b_${building.id}_${Math.floor(building.health)}_${building.isConstructed}_${buildPercent}`;

        if (lastUnitInfoStateKey === stateKey) return;
        lastUnitInfoStateKey = stateKey;

        if (!building.isConstructed) {
            infoPanel.innerHTML = `
                <div class="panel-header">
                    <h3 class="panel-title">🔨 ${building.name} (Em Obras)</h3>
                    <span style="font-size:11px;color:var(--muted)">${building.owner === 'player' ? 'Aliado' : 'Inimigo'}</span>
                </div>
                <div class="single-entity-view">
                    <div class="stat-bar">
                        <div class="stat-label">
                            <span>Progresso da Obra</span>
                            <span>${buildPercent}% (${Math.floor(building.buildProgress)}/${building.buildTime}s)</span>
                        </div>
                        <div class="bar-container">
                            <div class="bar-fill" style="width: ${buildPercent}%; background: #f59e0b"></div>
                        </div>
                    </div>
                    <div class="stat-bar">
                        <div class="stat-label">
                            <span>Estrutura</span>
                            <span>${Math.floor(building.health)}/${building.maxHealth} HP</span>
                        </div>
                        <div class="bar-container">
                            <div class="bar-fill health-bar" style="width: ${healthPercent}%; background: ${getHealthColor(healthPercent / 100)}"></div>
                        </div>
                    </div>
                    <div class="entity-status-box" style="border-left-color: #f59e0b">
                        <span>🚧</span>
                        <span>Canteiro de obras ativo. Requer a presença de um camponês para erguer a estrutura.</span>
                    </div>
                </div>
            `;
            return;
        }

        infoPanel.innerHTML = `
            <div class="panel-header">
                <h3 class="panel-title">${building.icon} ${building.name}</h3>
                <span style="font-size:11px;color:var(--muted)">${building.owner === 'player' ? 'Aliado' : 'Inimigo'}</span>
            </div>
            <div class="single-entity-view">
                <div class="stat-bar">
                    <div class="stat-label">
                        <span>Integridade</span>
                        <span>${Math.floor(building.health)}/${building.maxHealth} (${healthPercent}%)</span>
                    </div>
                    <div class="bar-container">
                        <div class="bar-fill health-bar" style="width: ${healthPercent}%; background: ${getHealthColor(healthPercent / 100)}"></div>
                    </div>
                </div>
                <div class="entity-status-box">
                    <span>🏛️</span>
                    <span>${building.trains?.length ? 'Centro de Treinamento de Tropas' : building.providesFood ? `Habitação (+${building.foodAmount} População)` : 'Estrutura Defensiva'}</span>
                </div>
            </div>
        `;
        return;
    }

    // 2. NENHUMA UNIDADE SELECIONADA
    if (gameState.selectedUnits.length === 0) {
        infoPanel.classList.remove('multi-selection');
        if (lastUnitInfoStateKey === 'none') return;
        lastUnitInfoStateKey = 'none';

        infoPanel.innerHTML = `
            <div class="panel-header">
                <h3 class="panel-title">🛡️ Comando do Reino</h3>
            </div>
            <div style="font-size:12px;color:var(--muted);line-height:1.5;">
                Nenhuma unidade selecionada.<br>
                <small style="color:#8f806a">Arraste para selecionar tropas ou clique em um camponês para construir.</small>
            </div>
        `;
        return;
    }

    // 3. UMA ÚNICA UNIDADE SELECIONADA
    if (gameState.selectedUnits.length === 1) {
        infoPanel.classList.remove('multi-selection');
        const unit = gameState.selectedUnits[0];
        const healthPercent = Math.max(0, Math.min(100, Math.round(unit.health / unit.maxHealth * 100)));
        const status = getUnitStatusInfo(unit);
        const stateKey = `u1_${unit.id}_${Math.floor(unit.health)}_${status.label}_${unit.gatherAmount}`;

        if (lastUnitInfoStateKey === stateKey) return;
        lastUnitInfoStateKey = stateKey;

        infoPanel.innerHTML = `
            <div class="panel-header">
                <h3 class="panel-title">${unit.icon} ${unit.name}</h3>
                <div class="panel-header-actions">
                    <button class="mini-action-btn" id="btnFocusSingle" title="Centralizar câmera">🎯 Focar</button>
                    <button class="mini-action-btn" id="btnStopSingle" title="Parar unidade">🛑 Parar</button>
                </div>
            </div>
            <div class="single-entity-view">
                <div class="stat-bar">
                    <div class="stat-label">
                        <span>Vida</span>
                        <span>${Math.floor(unit.health)}/${unit.maxHealth} HP (${healthPercent}%)</span>
                    </div>
                    <div class="bar-container">
                        <div class="bar-fill" style="width: ${healthPercent}%; background: ${getHealthColor(healthPercent / 100)}"></div>
                    </div>
                </div>

                <div class="entity-stats-grid">
                    <div class="stat-item"><span>Ataque:</span><span>${unit.attack > 0 ? unit.attack : 'Nenhum'}</span></div>
                    <div class="stat-item"><span>Velocidade:</span><span>${unit.speed}</span></div>
                    <div class="stat-item"><span>Alcance:</span><span>${unit.attackRange > 0 ? unit.attackRange + 'px' : 'Corpo a corpo'}</span></div>
                    <div class="stat-item"><span>Função:</span><span>${unit.canGather ? 'Trabalhador' : 'Combatente'}</span></div>
                </div>

                ${unit.returning && unit.gatherAmount > 0 ? `
                    <div class="entity-status-box" style="border-left-color: #ffd700">
                        <span>${unit.gatherType === 'gold' ? '🪙' : '🪵'}</span>
                        <span>Carregando ${unit.gatherAmount}x ${unit.gatherType === 'gold' ? 'Ouro' : 'Madeira'}</span>
                    </div>
                ` : ''}

                <div class="entity-status-box">
                    <span>${status.icon}</span>
                    <span>${status.label}: ${status.detail}</span>
                </div>
            </div>
        `;

        document.getElementById('btnFocusSingle')?.addEventListener('click', () => focusCameraOnSelection());
        document.getElementById('btnStopSingle')?.addEventListener('click', () => stopSelectedUnits());
        return;
    }

    // 4. MÚLTIPLAS UNIDADES SELECIONADAS (Warcraft / Age of Empires Style)
    infoPanel.classList.add('multi-selection');

    // Agrupar tipos de unidades selecionadas
    const typeCounts = {};
    const typeIcons = {};
    for (const u of gameState.selectedUnits) {
        typeCounts[u.name] = (typeCounts[u.name] || 0) + 1;
        typeIcons[u.name] = u.icon;
    }

    // Se o filtro ativo não existe mais na seleção, reseta para TODOS
    if (activeSubgroupFilter !== 'ALL' && !typeCounts[activeSubgroupFilter]) {
        activeSubgroupFilter = 'ALL';
    }

    const stateKey = `multi_${gameState.selectedUnits.map(u => `${u.id}:${Math.floor(u.health)}:${u.targetX !== null}:${u.gathering}:${u.returning}:${Boolean(u.attackTarget)}`).join('|')}_${activeSubgroupFilter}_${gameState.hoveredUnitId}`;

    if (lastUnitInfoStateKey === stateKey) return;
    lastUnitInfoStateKey = stateKey;

    // Montar abas de filtro de sub-grupo
    let subgroupTabsHtml = `
        <button class="subgroup-pill ${activeSubgroupFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">
            <span>⚔️ Todos</span>
            <span class="badge">${gameState.selectedUnits.length}</span>
        </button>
    `;

    for (const [typeName, count] of Object.entries(typeCounts)) {
        subgroupTabsHtml += `
            <button class="subgroup-pill ${activeSubgroupFilter === typeName ? 'active' : ''}" data-filter="${typeName}">
                <span>${typeIcons[typeName] || '👤'} ${typeName}</span>
                <span class="badge">${count}</span>
            </button>
        `;
    }

    // Montar grid de cards de unidades
    const visibleUnits = activeSubgroupFilter === 'ALL'
        ? gameState.selectedUnits
        : gameState.selectedUnits.filter(u => u.name === activeSubgroupFilter);

    let unitCardsHtml = '';
    for (const u of visibleUnits) {
        const hpPercent = Math.max(0, Math.min(100, Math.round(u.health / u.maxHealth * 100)));
        const status = getUnitStatusInfo(u);
        const isHovered = gameState.hoveredUnitId === u.id;

        unitCardsHtml += `
            <div class="unit-card ${isHovered ? 'hovered-unit' : ''}" data-unit-id="${u.id}" title="${u.name} - ${Math.floor(u.health)}/${u.maxHealth} HP\nClique para selecionar apenas esta unidade.\nShift+Clique ou [✕] para desmarcar.">
                <button class="unit-card-remove" data-remove-id="${u.id}" title="Remover da seleção">✕</button>
                <div class="unit-card-portrait">${u.icon}</div>
                <div class="unit-card-name">${u.name}</div>
                <div class="unit-card-hp-container">
                    <div class="unit-card-hp-fill" style="width: ${hpPercent}%; background: ${getHealthColor(hpPercent / 100)}"></div>
                </div>
                <div class="unit-card-status">
                    <span>${status.icon}</span>
                    <span>${status.label}</span>
                </div>
            </div>
        `;
    }

    infoPanel.innerHTML = `
        <div class="panel-header">
            <h3 class="panel-title">🛡️ Tropa Selecionada (${gameState.selectedUnits.length})</h3>
            <div class="panel-header-actions">
                <button class="mini-action-btn" id="btnFocusMulti" title="Centralizar câmera na tropa">🎯 Focar</button>
                <button class="mini-action-btn" id="btnStopMulti" title="Parar tropa (S)">🛑 Parar</button>
                <button class="mini-action-btn" id="btnClearMulti" title="Limpar seleção (Esc)">✕ Limpar</button>
            </div>
        </div>
        <div class="subgroup-tabs">${subgroupTabsHtml}</div>
        <div class="unit-grid">${unitCardsHtml}</div>
    `;

    // Eventos do cabeçalho
    document.getElementById('btnFocusMulti')?.addEventListener('click', () => focusCameraOnSelection());
    document.getElementById('btnStopMulti')?.addEventListener('click', () => stopSelectedUnits());
    document.getElementById('btnClearMulti')?.addEventListener('click', () => {
        gameState.selectedUnits = [];
        gameState.hoveredUnitId = null;
        updateUnitInfo();
    });

    // Eventos das abas de subgrupo
    infoPanel.querySelectorAll('.subgroup-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = btn.getAttribute('data-filter');
            if (e.shiftKey || e.ctrlKey) {
                // Shift/Ctrl refina a seleção de fato
                filterSelectionByType(filter);
            } else {
                // Clique simples alterna a exibição do subgrupo no painel
                activeSubgroupFilter = filter;
            }
            lastUnitInfoStateKey = '';
            updateUnitInfo();
        });

        btn.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const filter = btn.getAttribute('data-filter');
            filterSelectionByType(filter);
            lastUnitInfoStateKey = '';
            updateUnitInfo();
        });
    });

    // Eventos dos cards de unidades
    infoPanel.querySelectorAll('.unit-card').forEach(card => {
        const unitId = card.getAttribute('data-unit-id');

        card.addEventListener('mouseenter', () => {
            gameState.hoveredUnitId = unitId;
        });

        card.addEventListener('mouseleave', () => {
            if (gameState.hoveredUnitId === unitId) {
                gameState.hoveredUnitId = null;
            }
        });

        card.addEventListener('click', (e) => {
            // Se clicou no botão [✕] de remover ou com shift
            if (e.target.classList.contains('unit-card-remove') || e.shiftKey) {
                e.stopPropagation();
                deselectUnit(unitId);
                updateUnitInfo();
                return;
            }

            // Clique normal seleciona apenas esta unidade
            selectOnlyUnit(unitId);
            updateUnitInfo();
        });
    });
}

let toastTimer = null;
export function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
}

export function addInGameChatMessage(sender, text, color = '#3b82f6') {
    const log = document.getElementById('ingameChatLog');
    if (!log) return;

    const div = document.createElement('div');
    div.className = 'ingame-chat-msg';

    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.style.color = color;
    senderSpan.textContent = sender + ':';

    const textSpan = document.createElement('span');
    textSpan.className = 'text';
    textSpan.textContent = ' ' + text;

    div.appendChild(senderSpan);
    div.appendChild(textSpan);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

export function setupInGameChat() {
    const chatBox = document.getElementById('ingameChatBox');
    const input = document.getElementById('ingameChatInput');
    const sendBtn = document.getElementById('ingameChatSendBtn');

    if (!input || !chatBox) return;

    function handleSend() {
        const text = input.value.trim();
        if (text) {
            const senderName = gameState.myRole === 'player' ? 'Host (Você)' : (gameState.myRole === 'enemy' ? 'Adversário' : 'Jogador');
            addInGameChatMessage(senderName, text, '#ffd700');

            if (gameState.gameMode === 'multiplayer') {
                broadcastNetAction({
                    type: 'ingame_chat',
                    senderName,
                    text
                });
            }
            input.value = '';
        }
        input.blur();
        chatBox.classList.remove('active');
    }

    sendBtn?.addEventListener('click', handleSend);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            // Se o mapa ou lobby não estão visíveis (jogo ativo)
            if (gameState.gameStarted && !gameState.gameOver) {
                if (document.activeElement === input) {
                    handleSend();
                } else {
                    e.preventDefault();
                    chatBox.classList.add('active');
                    input.focus();
                }
            }
        }
    });
}

export { updateUI, updateCommandPanel, updateUnitInfo, trainUnit };
