export class MapManager {
    constructor() {
        this.maps = [];
        this.selectedMap = null;
        this.cacheThumbnails = new Map();
        this.loading = false;
    }

    /**
     * Escaneia a pasta /maps dinamicamente em tempo de execução via API REST
     * Retorna a lista de mapas atualizada
     */
    async scanMaps() {
        this.loading = true;
        try {
            const manifestRes = await fetch('./maps/index.json?t=' + Date.now(), { cache: 'no-store' });
            if (!manifestRes.ok) throw new Error(`Manifest HTTP ${manifestRes.status}`);

            const manifest = await manifestRes.json();
            const files = Array.isArray(manifest?.files) ? manifest.files : null;
            if (!files) throw new Error('Manifesto inválido: esperado { files: [] }');

            const loadedMaps = [];
            for (const fileName of files) {
                if (typeof fileName !== 'string' || !fileName.toLowerCase().endsWith('.json')) continue;
                try {
                    const fileRes = await fetch(`./maps/${fileName}?t=${Date.now()}`, { cache: 'no-store' });
                    if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
                    const mapData = await fileRes.json();
                    mapData.fileName = fileName;
                    if (!mapData.id) mapData.id = fileName.replace(/\.json$/i, '');
                    loadedMaps.push(mapData);
                } catch (error) {
                    loadedMaps.push({
                        id: fileName.replace(/\.json$/i, ''),
                        name: fileName,
                        fileName,
                        corrupted: true,
                        error: error.message
                    });
                    console.warn(`[MapManager] Falha ao carregar mapa "${fileName}":`, error.message);
                }
            }

            const validMaps = loadedMaps.filter(m => !m.corrupted);
            this.maps = validMaps.length > 0 ? loadedMaps : [...FALLBACK_MAPS];
        } catch (err) {
            console.warn('[MapManager] Não foi possível carregar ./maps/index.json (usando mapas integrados de fallback):', err.message);
            this.maps = [...FALLBACK_MAPS];
        } finally {
            this.loading = false;
        }

        // Se o mapa selecionado anteriormente não existir mais, seleciona o primeiro
        if (!this.selectedMap || !this.maps.some(m => m.id === this.selectedMap.id)) {
            this.selectedMap = this.maps.find(m => !m.corrupted) || this.maps[0];
        }
        return this.maps;
    }

    getMapById(id) {
        return this.maps.find(m => m.id === id) || null;
    }

    /**
     * Renderiza o minimapa no Canvas de Preview no estilo Warcraft 3
     * Suporta imagens customizadas, minimapa procedural ou fallback com selo de erro
     */
    async renderPreview(canvas, mapData) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // Se mapa corrompido, exibe placeholder clássico com aviso
        if (!mapData || mapData.corrupted) {
            this.renderErrorPlaceholder(ctx, w, h, mapData?.error || 'Arquivo de mapa corrompido ou formato inválido');
            return;
        }

        // Se tiver imagem de preview definida
        if (mapData.preview) {
            const loaded = await this.renderImagePreview(ctx, w, h, mapData.preview);
            if (loaded) return;
            // Se falhou carregar a imagem, cai para procedural
        }

        // Renderização Procedural em Tempo Real do Minimapa do Terreno
        this.renderProceduralMinimap(ctx, w, h, mapData);
    }

    renderProceduralMinimap(ctx, width, height, mapData) {
        const mapW = mapData.width || 80;
        const mapH = mapData.height || 80;
        const tilePixelW = width / mapW;
        const tilePixelH = height / mapH;

        const palette = mapData.palette || {
            grass: '#4a7c3f',
            tree: '#2d5a1e',
            water: '#2a5f8f',
            mountain: '#6b6b6b',
            gold: '#ffd700',
            path: '#8b7355'
        };

        const mapIndex = typeof mapData.mapIndex === 'number' ? mapData.mapIndex : 0;

        // Fundo base
        ctx.fillStyle = palette.grass;
        ctx.fillRect(0, 0, width, height);

        // Se o mapa possui matriz explícita desenhada no editor
        if (Array.isArray(mapData.grid) && mapData.grid.length > 0) {
            const colorMap = {
                0: palette.grass,
                1: palette.tree,
                2: palette.water,
                3: palette.mountain,
                4: palette.gold,
                5: palette.path || '#8b7355'
            };
            for (let y = 0; y < mapH; y++) {
                const row = mapData.grid[y];
                if (!row) continue;
                for (let x = 0; x < mapW; x++) {
                    const t = row[x];
                    if (t !== 0 && colorMap[t]) {
                        ctx.fillStyle = colorMap[t];
                        ctx.fillRect(x * tilePixelW, y * tilePixelH, tilePixelW + 0.6, tilePixelH + 0.6);
                    }
                }
            }

            // Desenhar pontos de spawn no minimapa
            if (Array.isArray(mapData.spawns)) {
                for (const s of mapData.spawns) {
                    ctx.fillStyle = (s.faction === 'player' || s.id === 'player') ? '#3b82f6' : '#ef4444';
                    ctx.beginPath();
                    ctx.arc(s.x * tilePixelW, s.y * tilePixelH, 3.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
            return;
        }

        // Desenho dos relevos simulados com ruído correspondente ao gerador
        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (x < 4 || x >= mapW - 4 || y < 4 || y >= mapH - 4) {
                    ctx.fillStyle = palette.mountain;
                    ctx.fillRect(x * tilePixelW, y * tilePixelH, tilePixelW + 0.6, tilePixelH + 0.6);
                    continue;
                }

                let noise;
                if (mapIndex === 2) {
                    noise = Math.sin(x * 0.08) * Math.sin(y * 0.08) + Math.cos(x * 0.04 + y * 0.04) * 0.3;
                    if (noise < -0.92) {
                        ctx.fillStyle = palette.water;
                        ctx.fillRect(x * tilePixelW, y * tilePixelH, tilePixelW + 0.6, tilePixelH + 0.6);
                    } else if (noise > 0.35) {
                        ctx.fillStyle = palette.tree;
                        ctx.fillRect(x * tilePixelW, y * tilePixelH, tilePixelW + 0.6, tilePixelH + 0.6);
                    }
                } else if (mapIndex === 1) {
                    noise = Math.sin(x * 0.09 + y * 0.03) * 0.8 + Math.cos(y * 0.16) * 0.45;
                    if (noise < -0.65) {
                        ctx.fillStyle = palette.water;
                        ctx.fillRect(x * tilePixelW, y * tilePixelH, tilePixelW + 0.6, tilePixelH + 0.6);
                    } else if (noise < -0.35) {
                        ctx.fillStyle = palette.tree;
                        ctx.fillRect(x * tilePixelW, y * tilePixelH, tilePixelW + 0.6, tilePixelH + 0.6);
                    }
                } else {
                    noise = Math.sin(x * 0.14) * Math.cos(y * 0.14) + Math.sin(x * 0.07 + y * 0.07) * 0.5;
                    if (noise < -0.65) {
                        ctx.fillStyle = palette.water;
                        ctx.fillRect(x * tilePixelW, y * tilePixelH, tilePixelW + 0.6, tilePixelH + 0.6);
                    } else if (noise < -0.35) {
                        ctx.fillStyle = palette.tree;
                        ctx.fillRect(x * tilePixelW, y * tilePixelH, tilePixelW + 0.6, tilePixelH + 0.6);
                    }
                }
            }
        }

        // Caminhos estratégicos clássicos (pontes de terra)
        ctx.strokeStyle = palette.path || '#8b7355';
        ctx.lineWidth = 3;
        ctx.beginPath();
        // Cantos ao centro
        ctx.moveTo(14 * tilePixelW, 14 * tilePixelH); ctx.lineTo(40 * tilePixelW, 40 * tilePixelH);
        ctx.moveTo(63 * tilePixelW, 63 * tilePixelH); ctx.lineTo(40 * tilePixelW, 40 * tilePixelH);
        ctx.moveTo(63 * tilePixelW, 14 * tilePixelH); ctx.lineTo(40 * tilePixelW, 40 * tilePixelH);
        ctx.moveTo(14 * tilePixelW, 63 * tilePixelH); ctx.lineTo(40 * tilePixelW, 40 * tilePixelH);
        // Anel periférico
        ctx.rect(14 * tilePixelW, 14 * tilePixelH, (63 - 14) * tilePixelW, (63 - 14) * tilePixelH);
        ctx.stroke();

        // Posições das 4 bases de spawn com marcadores de facção
        const spawns = [
            { x: 14, y: 14, color: '#3b82f6', label: '1' },
            { x: 63, y: 63, color: '#ef4444', label: '2' },
            { x: 63, y: 14, color: '#10b981', label: '3' },
            { x: 14, y: 63, color: '#f59e0b', label: '4' },
        ];

        // Centro disputado (Mina central de ouro)
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(40 * tilePixelW, 40 * tilePixelH, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Spawns
        for (const sp of spawns) {
            const px = sp.x * tilePixelW;
            const py = sp.y * tilePixelH;

            // Halo luminoso
            const grad = ctx.createRadialGradient(px, py, 1, px, py, 10);
            grad.addColorStop(0, sp.color);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(px, py, 10, 0, Math.PI * 2);
            ctx.fill();

            // Ponto do Castelo
            ctx.fillStyle = sp.color;
            ctx.beginPath();
            ctx.arc(px, py, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // Mina de ouro inicial próxima
            ctx.fillStyle = '#ffea00';
            ctx.fillRect(px - 9, py - 9, 3.5, 3.5);
        }

        // Vinheta sutil / efeito de relevo RTS Warcraft
        const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.35, width / 2, height / 2, width * 0.72);
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, width, height);

        // Grade tática suave de radar
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(width * 0.17, height * 0.17, width * 0.66, height * 0.66);
    }

    renderImagePreview(ctx, width, height, imageUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                ctx.drawImage(img, 0, 0, width, height);
                resolve(true);
            };
            img.onerror = () => {
                resolve(false);
            };
            img.src = imageUrl;
        });
    }

    renderErrorPlaceholder(ctx, width, height, reason) {
        // Fundo escuro com padrão de aviso
        ctx.fillStyle = '#140c0c';
        ctx.fillRect(0, 0, width, height);

        // Linhas de advertência diagonais
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.15)';
        ctx.lineWidth = 6;
        for (let i = -width; i < width * 2; i += 20) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + height, height);
            ctx.stroke();
        }

        // Ícone de mapa corrompido / exclamação
        ctx.fillStyle = '#ef4444';
        ctx.font = '36px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚠️', width / 2, height / 2 - 24);

        // Texto informativo
        ctx.fillStyle = '#fca5a5';
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillText('MAPA INVÁLIDO', width / 2, height / 2 + 16);

        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px "Segoe UI", sans-serif';
        const safeReason = (reason && reason.length > 32) ? reason.slice(0, 32) + '...' : (reason || 'Erro no arquivo');
        ctx.fillText(safeReason, width / 2, height / 2 + 34);
    }
}

export const mapManager = new MapManager();
