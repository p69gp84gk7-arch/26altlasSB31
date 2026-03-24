// ==========================================
// 1. CONFIGURATION
// ==========================================
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map', { doubleClickZoom: false }).setView([42.7905, 0.5912], 14);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map);

let mntStore = [];
let drawStore = [];
let currentPoints = [];
let tempLayer = null;
let currentTool = null;
let chartInstance = null;
let cursorMarker = null;

// ==========================================
// 2. IMPORTATION MNT
// ==========================================
document.getElementById('file-input').onchange = async (e) => {
    for (const file of e.target.files) {
        if (!file.name.match(/\.(tif|tiff)$/i)) continue;
        
        const buffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(buffer);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox();
        const raster = await image.readRasters();
        
        const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
        const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);
        const visual = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color: "#00d1b2", weight: 2, fillOpacity: 0.15 }).addTo(map);

        mntStore.push({ id: Date.now()+Math.random(), name: file.name, bbox, width: image.getWidth(), height: image.getHeight(), data: raster[0], visual, visible: true });
        map.fitBounds(visual.getBounds());
    }
    updateMntUI();
};

function updateMntUI() {
    const list = document.getElementById('mnt-list');
    list.innerHTML = '';
    mntStore.forEach(m => {
        list.innerHTML += `
        <div class="card">
            <div class="card-header">
                <div>
                    <input type="checkbox" ${m.visible ? 'checked' : ''} onchange="toggleMNT(${m.id})">
                    <span title="${m.name}">${m.name.length > 20 ? m.name.substring(0,18)+'...' : m.name}</span>
                </div>
                <button class="btn-del" onclick="deleteMNT(${m.id})">✕</button>
            </div>
        </div>`;
    });
}

window.toggleMNT = (id) => {
    const m = mntStore.find(x => x.id === id);
    m.visible = !m.visible;
    if (m.visible) m.visual.addTo(map); else map.removeLayer(m.visual);
};

window.deleteMNT = (id) => {
    const m = mntStore.find(x => x.id === id);
    map.removeLayer(m.visual);
    mntStore = mntStore.filter(x => x.id !== id);
    updateMntUI();
};

function getZ(l93) {
    for (let m of mntStore) {
        if (!m.visible) continue;
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const px = Math.floor(((l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0])) * m.width);
            const py = Math.floor(((m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1])) * m.height);
            const val = m.data[py * m.width + px];
            if (val > -1000) return val;
        }
    } return null;
}

// ==========================================
// 3. OUTILS DE TRACÉ
// ==========================================
window.startTool = (tool) => {
    currentTool = tool;
    currentPoints = [];
    if (tempLayer) map.removeLayer(tempLayer);
    
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-' + tool).classList.add('active');
};

map.on('click', (e) => {
    if (!currentTool) return;
    
    currentPoints.push(e.latlng);
    
    if (tempLayer) map.removeLayer(tempLayer);
    
    const color = currentTool === 'area' ? '#e67e22' : (currentTool === 'profile' ? '#f1c40f' : '#3498db');
    if (currentTool === 'area') {
        tempLayer = L.polygon(currentPoints, { color, weight: 3, fillOpacity: 0.3 }).addTo(map);
    } else {
        tempLayer = L.polyline(currentPoints, { color, weight: 4 }).addTo(map);
    }

    if (currentTool === 'profile' && currentPoints.length === 2) {
        finalizeDraw();
    }
});

map.on('dblclick', () => {
    if (currentTool && currentTool !== 'profile') {
        // Le double-clic génère un clic en trop, on le retire
        currentPoints.pop(); 
        if (currentPoints.length > 1) finalizeDraw();
    }
});

function finalizeDraw() {
    const type = currentTool;
    const color = type === 'area' ? '#e67e22' : (type === 'profile' ? '#f1c40f' : '#3498db');
    
    const layer = type === 'area' 
        ? L.polygon(currentPoints, { color, weight: 3, fillOpacity: 0.3 }).addTo(map) 
        : L.polyline(currentPoints, { color, weight: 4 }).addTo(map);

    if (tempLayer) map.removeLayer(tempLayer);
    tempLayer = null;

    const drawObj = { 
        id: Date.now(), type, layer, 
        ptsGPS: [...currentPoints], 
        visible: true, color, 
        editGroup: L.layerGroup().addTo(map),
        statsHtml: ""
    };
    
    drawStore.push(drawObj);
    recalculateStats(drawObj);
    makeEditable(drawObj);
    
    if (type === 'profile') generateProfile(drawObj);
    
    currentTool = null;
    currentPoints = [];
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
}

// ==========================================
// 4. CALCULS ET ÉDITION (LIVE)
// ==========================================
function recalculateStats(d) {
    const l93 = d.ptsGPS.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    
    if (d.type === 'profile' || d.type === 'line') {
        let dist = 0;
        for (let i = 1; i < l93.length; i++) {
            dist += Math.sqrt(Math.pow(l93[i][0]-l93[i-1][0], 2) + Math.pow(l93[i][1]-l93[i-1][1], 2));
        }
        const z1 = getZ(l93[0]) || 0;
        const z2 = getZ(l93[l93.length-1]) || 0;
        const dz = Math.abs(z2 - z1);
        const pente = dist > 0 ? (dz / dist * 100).toFixed(1) : 0;
        
        d.totalDist = dist;
        d.statsHtml = `L: <b>${dist.toFixed(2)} m</b> | Pente: <b>${pente}%</b><br>ΔZ: <b>${dz.toFixed(2)} m</b>`;
    } else if (d.type === 'area') {
        let area = 0;
        for (let i = 0; i < l93.length; i++) {
            let j = (i+1) % l93.length;
            area += l93[i][0]*l93[j][1] - l93[j][0]*l93[i][1];
        }
        d.statsHtml = `Surface: <b>${(Math.abs(area)/2).toFixed(2)} m²</b>`;
    }
    
    // Mise à jour de l'affichage HTML ciblé (pour ne pas casser l'édition)
    const statsDiv = document.getElementById(`stats-${d.id}`);
    if (statsDiv) statsDiv.innerHTML = d.statsHtml;
    else updateDrawUI(); // Premier rendu
}

function updateDrawUI() {
    const list = document.getElementById('measure-list');
    list.innerHTML = '';
    drawStore.forEach(d => {
        const title = d.type === 'profile' ? 'PROFIL' : (d.type === 'line' ? 'LIGNE' : 'SURFACE');
        list.innerHTML += `
        <div class="card" style="border-left-color: ${d.color}">
            <div class="card-header">
                <div>
                    <input type="checkbox" ${d.visible ? 'checked' : ''} onchange="toggleDraw(${d.id})">
                    <input type="color" class="color-picker" value="${d.color}" onchange="changeColor(${d.id}, this.value)">
                    <strong>${title}</strong>
                </div>
                <button class="btn-del" onclick="deleteDraw(${d.id})">✕</button>
            </div>
            <div id="stats-${d.id}" style="margin-top:5px; font-size:1.1em;">${d.statsHtml}</div>
            ${d.type === 'profile' ? `<button onclick="generateProfileById(${d.id})" style="width:100%; margin-top:8px; font-size:0.8em; cursor:pointer; background:#333; color:white; border:1px solid #555; padding:5px; border-radius:3px;">Afficher le profil</button>` : ''}
        </div>`;
    });
}

function makeEditable(d) {
    d.editGroup.clearLayers();
    if (!d.visible) return;

    const icon = L.divIcon({ className: 'edit-handle', iconSize: [12, 12] });

    d.ptsGPS.forEach((pt, idx) => {
        const marker = L.marker(pt, { icon, draggable: true }).addTo(d.editGroup);
        
        marker.on('drag', (e) => {
            d.ptsGPS[idx] = e.latlng;
            d.layer.setLatLngs(d.ptsGPS);
            recalculateStats(d);
            if (d.type === 'profile') generateProfile(d);
        });
    });
}

window.toggleDraw = (id) => {
    const d = drawStore.find(x => x.id === id);
    d.visible = !d.visible;
    if (d.visible) {
        d.layer.addTo(map);
        makeEditable(d);
    } else {
        map.removeLayer(d.layer);
        d.editGroup.clearLayers();
    }
};

window.changeColor = (id, color) => {
    const d = drawStore.find(x => x.id === id);
    d.color = color;
    d.layer.setStyle({ color: color });
};

window.deleteDraw = (id) => {
    const d = drawStore.find(x => x.id === id);
    map.removeLayer(d.layer);
    map.removeLayer(d.editGroup);
    drawStore = drawStore.filter(x => x.id !== id);
    updateDrawUI();
    document.getElementById('profile-window').style.display = 'none';
};

// ==========================================
// 5. PROFIL ALTIMÉTRIQUE (AXE X EN MÈTRES)
// ==========================================
window.generateProfileById = (id) => {
    const d = drawStore.find(x => x.id === id);
    generateProfile(d);
};

function generateProfile(d) {
    document.getElementById('profile-window').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    
    const l93Pts = d.ptsGPS.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    let chartData = [];
    let geoRef = [];
    const pointsCount = 100;

    for (let i = 0; i <= pointsCount; i++) {
        const t = i / pointsCount;
        const x = l93Pts[0][0] + (l93Pts[1][0] - l93Pts[0][0]) * t;
        const y = l93Pts[0][1] + (l93Pts[1][1] - l93Pts[0][1]) * t;
        const z = getZ([x, y]) || 0;
        
        // Axe X en vrais mètres (Float)
        const currentDist = t * d.totalDist;
        chartData.push({ x: parseFloat(currentDist.toFixed(2)), y: parseFloat(z.toFixed(2)) });
        geoRef.push(proj4("EPSG:2154", "EPSG:4326", [x, y]));
    }

    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ label: 'Altitude (m)', data: chartData, borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.2)', fill: true, pointRadius: 0, tension: 0.1 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { 
                x: { 
                    type: 'linear', 
                    title: { display: true, text: 'Distance (m)' },
                    ticks: { callback: function(val) { return val.toFixed(0) + 'm'; } }
                },
                y: { title: { display: true, text: 'Z (m)' } }
            },
            onHover: (event, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const pos = geoRef[idx];
                    if (!cursorMarker) cursorMarker = L.circleMarker([pos[1], pos[0]], { radius: 6, color: 'red', fillColor: '#fff', fillOpacity: 1 }).addTo(map);
                    else cursorMarker.setLatLng([pos[1], pos[0]]);
                }
            }
        }
    });

    document.getElementById('profileChart').onmouseleave = () => {
        if (cursorMarker) { map.removeLayer(cursorMarker); cursorMarker = null; }
    };
}

// ==========================================
// 6. SUIVI SOURIS COORDONNÉES
// ==========================================
map.on('mousemove', (e) => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    const z = getZ(l93);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    document.getElementById('cur-z').textContent = z !== null ? z.toFixed(2) : "---";
});
