proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

// Centrage Luchon par défaut
const map = L.map('map').setView([42.7905, 0.5912], 14);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' }).addTo(map);

let layersStore = []; // Stocke les données MNT et les objets graphiques
let points = [];
let measureLine = null;
let chartInstance = null;

// GESTION DES ENTRÉES
const handleFiles = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
            await processMNT(file);
        }
    }
};
document.getElementById('file-input').onchange = handleFiles;
document.getElementById('folder-input').onchange = handleFiles;

async function processMNT(file) {
    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox();
    const data = await image.readRasters();

    const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
    const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);
    
    // Création du rectangle sur la carte
    const rect = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color: "#00d1b2", weight: 2, fillOpacity: 0.1 }).addTo(map);
    
    const layerId = Date.now() + Math.random();
    const layerObj = { id: layerId, name: file.name, image, bbox, data, visual: rect, visible: true };
    layersStore.push(layerObj);
    
    refreshLayerManager();
    map.fitBounds(rect.getBounds());
}

function refreshLayerManager() {
    const container = document.getElementById('layer-manager');
    container.innerHTML = '';
    layersStore.forEach(l => {
        const div = document.createElement('div');
        div.className = 'layer-item';
        div.innerHTML = `
            <input type="checkbox" ${l.visible ? 'checked' : ''} onchange="toggleLayer(${l.id})">
            <span title="${l.name}">${l.name.substring(0,15)}...</span>
            <button class="btn-del" onclick="removeLayer(${l.id})">✕</button>
        `;
        container.appendChild(div);
    });
}

window.toggleLayer = (id) => {
    const l = layersStore.find(x => x.id === id);
    l.visible = !l.visible;
    if (l.visible) l.visual.addTo(map); else map.removeLayer(l.visual);
};

window.removeLayer = (id) => {
    const l = layersStore.find(x => x.id === id);
    map.removeLayer(l.visual);
    layersStore = layersStore.filter(x => x.id !== id);
    refreshLayerManager();
};

// LECTURE Z ET PROFIL
map.on('mousemove', (e) => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    let z = getZ(l93);
    document.getElementById('cur-z').textContent = z ? z.toFixed(2) : "0.00";
});

function getZ(l93) {
    for (let m of layersStore) {
        if (!m.visible) continue;
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const xP = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yP = (m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1]);
            const val = m.data[0][Math.floor(yP * m.image.getHeight()) * m.image.getWidth() + Math.floor(xP * m.image.getWidth())];
            if (val > -500) return val;
        }
    }
    return null;
}

document.getElementById('btn-measure').onclick = () => {
    points = [];
    if (measureLine) map.removeLayer(measureLine);
    map.on('click', (e) => {
        points.push(e.latlng);
        if (measureLine) map.removeLayer(measureLine);
        measureLine = L.polyline(points, {color: '#f1c40f', weight: 3}).addTo(map);
        if (points.length === 2) {
            map.off('click');
            drawProfile();
        }
    });
};

function drawProfile() {
    let profileData = [];
    const p1_l93 = proj4("EPSG:4326", "EPSG:2154", [points[0].lng, points[0].lat]);
    const p2_l93 = proj4("EPSG:4326", "EPSG:2154", [points[1].lng, points[1].lat]);
    const totalDist = Math.sqrt(Math.pow(p2_l93[0]-p1_l93[0], 2) + Math.pow(p2_l93[1]-p1_l93[1], 2));

    const nbPoints = 100; // Résolution du profil
    for (let i = 0; i <= nbPoints; i++) {
        const pct = i / nbPoints;
        const curX = p1_l93[0] + (p2_l93[0] - p1_l93[0]) * pct;
        const curY = p1_l93[1] + (p2_l93[1] - p1_l93[1]) * pct;
        const z = getZ([curX, curY]);
        profileData.push({ x: (pct * totalDist).toFixed(2), y: z });
    }

    document.getElementById('profile-window').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ label: 'Altitude (m)', data: profileData, borderColor: '#00d1b2', backgroundColor: 'rgba(0,209,178,0.1)', fill: true, pointRadius: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'linear' } } }
    });
}

window.exportData = (format) => {
    if (format === 'png') {
        const link = document.createElement('a');
        link.download = 'profil.png';
        link.href = document.getElementById('profileChart').toDataURL();
        link.click();
    } else if (format === 'csv') {
        let csv = "Distance(m),Altitude(m)\n";
        chartInstance.data.datasets[0].data.forEach(d => { csv += `${d.x},${d.y}\n`; });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'profil.csv'; a.click();
    }
};
