// --- 1. CONFIGURATION DE BASE ---
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map', { doubleClickZoom: false }).setView([42.7905, 0.5912], 14);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri', maxZoom: 19 }).addTo(map);

let mntData = [];
let measures = [];
let activeTool = null;
let currentPoints = [];
let currentLayer = null;
let chartInstance = null;
let cursorMarker = null;

// --- 2. GESTION DES FICHIERS MNT ---
const processFiles = async (e) => {
    const files = Array.from(e.target.files).filter(f => f.name.match(/\.(tif|tiff)$/i));
    if (files.length === 0) return;
    
    document.getElementById('loading').style.display = 'block';

    for (const file of files) {
        try {
            const buffer = await file.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(buffer);
            const image = await tiff.getImage();
            
            const layerObj = {
                id: Date.now() + Math.random(),
                name: file.name,
                bbox: image.getBoundingBox(),
                width: image.getWidth(),
                height: image.getHeight(),
                data: (await image.readRasters())[0],
                rect: null
            };

            // Tracé de l'emprise sur la carte
            const sw = proj4("EPSG:2154", "EPSG:4326", [layerObj.bbox[0], layerObj.bbox[1]]);
            const ne = proj4("EPSG:2154", "EPSG:4326", [layerObj.bbox[2], layerObj.bbox[3]]);
            layerObj.rect = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color: "#00d1b2", weight: 2, fillOpacity: 0.1, interactive: false }).addTo(map);

            mntData.push(layerObj);
            map.fitBounds(layerObj.rect.getBounds());
        } catch (err) {
            console.error("Erreur lecture:", file.name, err);
            alert("Impossible de lire : " + file.name);
        }
    }
    document.getElementById('loading').style.display = 'none';
    renderLayerList();
};

document.getElementById('file-input').onchange = processFiles;
document.getElementById('folder-input').onchange = processFiles;

function renderLayerList() {
    const list = document.getElementById('layer-list');
    list.innerHTML = '';
    mntData.forEach(m => {
        list.innerHTML += `<div class="card">MNT : ${m.name.substring(0,15)}...<button class="btn-del" onclick="deleteMNT(${m.id})">✕</button></div>`;
    });
}

window.deleteMNT = (id) => {
    const m = mntData.find(x => x.id === id);
    map.removeLayer(m.rect);
    mntData = mntData.filter(x => x.id !== id);
    renderLayerList();
};

// --- 3. FONCTION DE CALCUL D'ALTITUDE ---
function getZ(l93) {
    for (let m of mntData) {
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const xFrac = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yFrac = (m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1]);
            const px = Math.floor(xFrac * m.width);
            const py = Math.floor(yFrac * m.height);
            const val = m.data[py * m.width + px];
            if (val !== undefined && val > -1000) return val;
        }
    }
    return null;
}

// Suivi de la souris
map.on('mousemove', (e) => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    const z = getZ(l93);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    document.getElementById('cur-z').textContent = z !== null ? z.toFixed(2) : "---";
});

// --- 4. GESTION DES OUTILS DE TRACÉ ---
window.startTool = (tool) => {
    activeTool = tool;
    currentPoints = [];
    if (currentLayer) map.removeLayer(currentLayer);
    
    document.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${tool}`).classList.add('active');

    map.off('click').on('click', (e) => {
        currentPoints.push(e.latlng);
        if (currentLayer) map.removeLayer(currentLayer);

        const opts = { weight: 5, color: tool === 'area' ? '#e67e22' : '#f1c40f', fillOpacity: 0.4 };
        currentLayer = tool === 'area' ? L.polygon(currentPoints, opts).addTo(map) : L.polyline(currentPoints, opts).addTo(map);

        if (tool === 'line' && currentPoints.length === 2) finalizeMeasure();
    });
};

map.on('dblclick', () => {
    if (activeTool && activeTool !== 'line' && currentPoints.length > 2) finalizeMeasure();
});

function finalizeMeasure() {
    map.off('click');
    document.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
    
    const measureObj = {
        id: Date.now(),
        type: activeTool,
        layer: currentLayer,
        pts: [...currentPoints],
        editGroup: L.layerGroup().addTo(map)
    };
    
    measures.push(measureObj);
    activeTool = null;
    currentLayer = null;
    currentPoints = [];

    buildEditMarkers(measureObj);
    processMeasureData(measureObj);
}

// --- 5. LOGIQUE D'ÉDITION ---
function buildEditMarkers(m) {
    m.editGroup.clearLayers();
    const icon = L.divIcon({ className: 'edit-marker', iconSize: [12, 12] });

    m.pts.forEach((pt, index) => {
        const marker = L.marker(pt, { icon: icon, draggable: true }).addTo(m.editGroup);
        
        marker.on('drag', (e) => {
            m.pts[index] = e.latlng;
            m.layer.setLatLngs(m.pts);
            processMeasureData(m); // Recalcul direct
        });
    });
}

// --- 6. CALCULS ET INTERFACE ---
function processMeasureData(m) {
    const l93 = m.pts.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    let result = "";

    if (m.type === 'line' || m.type === 'mline') {
        let dist = 0;
        for (let i = 1; i < l93.length; i++) {
            dist += Math.sqrt(Math.pow(l93[i][0]-l93[i-1][0], 2) + Math.pow(l93[i][1]-l93[i-1][1], 2));
        }
        const z1 = getZ(l93[0]) || 0;
        const z2 = getZ(l93[l93.length-1]) || 0;
        const slope = dist > 0 ? (Math.abs(z2-z1)/dist*100).toFixed(2) : 0;
        
        result = `Dist: <b>${dist.toFixed(2)}m</b><br>Pente: <b>${slope}%</b> | ΔZ: <b>${(z2-z1).toFixed(2)}m</b>`;
        
        if (m.type === 'mline') generateProfile(m.pts, l93, dist);

    } else if (m.type === 'area') {
        let area = 0;
        for (let i = 0; i < l93.length; i++) {
            let j = (i+1) % l93.length;
            area += l93[i][0]*l93[j][1] - l93[j][0]*l93[i][1];
        }
        result = `Surface: <b>${(Math.abs(area)/2).toFixed(2)} m²</b>`;
    }
    
    m.html = result;
    renderMeasureList();
}

function renderMeasureList() {
    const list = document.getElementById('measure-list');
    list.innerHTML = '';
    measures.forEach(m => {
        list.innerHTML += `
        <div class="card">
            <button class="btn-del" onclick="deleteMeasure(${m.id})">✕</button>
            <strong style="color:var(--accent); text-transform:uppercase;">${m.type}</strong><br>
            ${m.html}
        </div>`;
    });
}

window.deleteMeasure = (id) => {
    const m = measures.find(x => x.id === id);
    map.removeLayer(m.layer);
    map.removeLayer(m.editGroup);
    measures = measures.filter(x => x.id !== id);
    renderMeasureList();
};

// --- 7. PROFIL ALTIMÉTRIQUE ---
function generateProfile(gpsPts, l93Pts, totalDist) {
    document.getElementById('profile-window').style.display = 'block';
    
    let chartData = [];
    let geoRef = [];
    const samples = 100;

    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        // Interpolation simple (segment global)
        const x = l93Pts[0][0] + (l93Pts[l93Pts.length-1][0] - l93Pts[0][0]) * t;
        const y = l93Pts[0][1] + (l93Pts[l93Pts.length-1][1] - l93Pts[0][1]) * t;
        const z = getZ([x, y]) || 0;
        
        chartData.push({ x: (t * totalDist).toFixed(1), y: z });
        geoRef.push(proj4("EPSG:2154", "EPSG:4326", [x, y]));
    }

    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ label: 'Altitude (m)', data: chartData, borderColor: '#00d1b2', backgroundColor: 'rgba(0, 209, 178, 0.2)', fill: true, pointRadius: 0, tension: 0.2 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { type: 'linear' } },
            onHover: (evt, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const pos = geoRef[idx];
                    if (!cursorMarker) cursorMarker = L.circleMarker([pos[1], pos[0]], { radius: 6, color: 'red', fillColor: 'white', fillOpacity: 1 }).addTo(map);
                    else cursorMarker.setLatLng([pos[1], pos[0]]);
                }
            }
        }
    });

    document.getElementById('profileChart').onmouseleave = () => {
        if (cursorMarker) { map.removeLayer(cursorMarker); cursorMarker = null; }
    };
}

window.exportChart = () => {
    const a = document.createElement('a');
    a.href = document.getElementById('profileChart').toDataURL('image/png');
    a.download = 'profil_luchon.png';
    a.click();
};
