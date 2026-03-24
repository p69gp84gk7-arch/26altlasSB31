// --- CONFIGURATION ---
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

let linePoints = [];
let isDrawing = false;
let chartInstance = null;
let loadedMNTs = []; // Stockage des dalles lues

// --- INITIALISATION CARTE ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'sat': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 },
            'topo': { type: 'raster', tiles: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'], tileSize: 256, subdomains: 'abc' }
        },
        layers: [
            { id: 'layer-sat', type: 'raster', source: 'sat', layout: { visibility: 'visible' } },
            { id: 'layer-topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } }
        ]
    },
    center: [2.35, 48.85], zoom: 5
});

// --- GESTION DOSSIER & MNT ---
document.getElementById('file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    const mntFiles = files.filter(f => f.name.toLowerCase().endsWith('.tif'));
    
    for (const file of mntFiles) {
        const li = document.createElement('li');
        li.textContent = file.name;
        document.getElementById('file-list').appendChild(li);
        
        // Lecture simplifiée du GeoTIFF
        const buffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(buffer);
        const image = await tiff.getImage();
        loadedMNTs.push({ name: file.name, image, bbox: image.getBoundingBox() });
    }
    alert(`${mntFiles.length} dalles MNT chargées.`);
});

// --- OUTIL DE DESSIN ---
document.getElementById('btn-draw').addEventListener('click', () => {
    isDrawing = true;
    linePoints = [];
    map.getCanvas().style.cursor = 'crosshair';
});

map.on('click', (e) => {
    if (!isDrawing) return;
    const pt = [e.lngLat.lng, e.lngLat.lat];
    linePoints.push(pt);
    updateMapLine();
});

map.on('dblclick', (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    map.getCanvas().style.cursor = '';
    generateProfile();
});

function updateMapLine() {
    const data = { type: 'Feature', geometry: { type: 'LineString', coordinates: linePoints } };
    if (map.getSource('path')) map.getSource('path').setData(data);
    else {
        map.addSource('path', { type: 'geojson', data });
        map.addLayer({ id: 'path', type: 'line', source: 'path', paint: { 'line-color': '#f1c40f', 'line-width': 4 } });
    }
}

// --- CALCUL DU PROFIL & DISTANCE ---
async function generateProfile() {
    if (linePoints.length < 2) return;
    let data = [];
    let dist = 0;

    for (let i = 0; i < linePoints.length; i++) {
        if (i > 0) dist += getDistance(linePoints[i-1], linePoints[i]);
        
        // Ici : Simulation d'altitude (Lien avec analyzeMNT à finaliser selon l'EPSG)
        let alt = 100 + Math.random() * 50; 
        data.push({ x: Math.round(dist), y: alt });
    }
    renderChart(data);
}

function getDistance(p1, p2) {
    const R = 6371000;
    const dLat = (p2[1]-p1[1]) * Math.PI/180;
    const dLon = (p2[0]-p1[0]) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1[1]*Math.PI/180)*Math.cos(p2[1]*Math.PI/180)*Math.sin(dLon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// --- RENDER & EXPORT ---
function renderChart(data) {
    document.getElementById('profile-container').style.display = 'block';
    document.getElementById('btn-export').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Profil (m)', data: data, borderColor: '#00d1b2', fill: true, backgroundColor: 'rgba(0,209,178,0.1)', tension: 0.1
            }]
        },
        options: { scales: { x: { type: 'linear', title: {display:true, text:'Distance (m)'} } } }
    });
}

document.getElementById('btn-export').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'profil.png';
    link.href = document.getElementById('profileChart').toDataURL();
    link.click();
});

document.getElementById('btn-clear').addEventListener('click', () => {
    linePoints = [];
    if (map.getSource('path')) map.getSource('path').setData({type:'FeatureCollection', features:[]});
    document.getElementById('profile-container').style.display = 'none';
});
