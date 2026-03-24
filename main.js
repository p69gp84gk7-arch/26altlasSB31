proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map').setView([42.7905, 0.5912], 14);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);

let layersStore = [];
let activeMeasure = null;
let currentPoints = [];
let savedMeasures = [];
let chartInstance = null;

// --- GESTIONNAIRE DE MESURE ---
function startMeasure(type) {
    if (activeMeasure) map.removeLayer(activeMeasure);
    currentPoints = [];
    map.off('click');
    map.on('click', (e) => handleMapClick(e, type));
}

function handleMapClick(e, type) {
    currentPoints.push(e.latlng);
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);

    if (activeMeasure) map.removeLayer(activeMeasure);

    if (type === 'line' || type === 'profile' || type === 'slope') {
        activeMeasure = L.polyline(currentPoints, { color: '#f1c40f', weight: 3 }).addTo(map);
    } else if (type === 'area') {
        activeMeasure = L.polygon(currentPoints, { color: '#e67e22', fillColor: '#e67e22', fillOpacity: 0.3 }).addTo(map);
    }

    // Fin de mesure
    if ((type === 'slope' && currentPoints.length === 2) || (type === 'profile' && currentPoints.length === 2)) {
        finishMeasure(type);
    }
}

// Double clic pour finir ligne ou surface
map.on('dblclick', () => {
    const type = (activeMeasure instanceof L.Polygon) ? 'area' : 'line';
    finishMeasure(type);
});

function finishMeasure(type) {
    map.off('click');
    let result = { type, id: Date.now(), layer: activeMeasure };
    
    // CALCULS DE PRÉCISION (LAMBERT 93)
    const ptsL93 = currentPoints.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    
    if (type === 'line') {
        let dist = 0;
        for(let i=1; i<ptsL93.length; i++) dist += Math.sqrt(Math.pow(ptsL93[i][0]-ptsL93[i-1][0], 2) + Math.pow(ptsL93[i][1]-ptsL93[i-1][1], 2));
        result.val = dist.toFixed(2) + " m";
    } else if (type === 'area') {
        result.val = calculateAreaL93(ptsL93).toFixed(2) + " m²";
    } else if (type === 'slope') {
        const z1 = getZ(ptsL93[0]), z2 = getZ(ptsL93[1]);
        const dist = Math.sqrt(Math.pow(ptsL93[1][0]-ptsL93[0][0], 2) + Math.pow(ptsL93[1][1]-ptsL93[0][1], 2));
        const slope = ((Math.abs(z2 - z1) / dist) * 100).toFixed(2);
        result.val = `Pente: ${slope}% (ΔZ: ${(z2-z1).toFixed(2)}m)`;
    } else if (type === 'profile') {
        drawProfile(currentPoints);
        result.val = "Profil généré";
    }

    savedMeasures.push(result);
    updateMeasurePanel();
    activeMeasure = null;
}

// Algorithme de Shoelace pour la surface en L93
function calculateAreaL93(coords) {
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
        let j = (i + 1) % coords.length;
        area += coords[i][0] * coords[j][1];
        area -= coords[j][0] * coords[i][1];
    }
    return Math.abs(area) / 2;
}

function updateMeasurePanel() {
    const list = document.getElementById('measure-list');
    list.innerHTML = '';
    savedMeasures.forEach(m => {
        const div = document.createElement('div');
        div.className = 'measure-card';
        div.innerHTML = `
            <button class="btn-del-mini" onclick="removeMeasure(${m.id})">✕</button>
            <h5>${m.type.toUpperCase()}</h5>
            <p><strong>Valeur : ${m.val}</strong></p>
        `;
        list.appendChild(div);
    });
}

window.removeMeasure = (id) => {
    const m = savedMeasures.find(x => x.id === id);
    if(m.layer) map.removeLayer(m.layer);
    savedMeasures = savedMeasures.filter(x => x.id !== id);
    updateMeasurePanel();
};

function changeScale() {
    const zoom = document.getElementById('map-scale').value;
    map.setZoom(zoom);
}

// --- REPRISE LOGIQUE MNT & Z ---
const handleFiles = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        if (file.name.toLowerCase().match(/\.(tif|tiff)$/)) {
            const buffer = await file.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(buffer);
            const image = await tiff.getImage();
            const bbox = image.getBoundingBox();
            const raster = await image.readRasters();
            layersStore.push({ name: file.name, image, bbox, data: raster[0] });
            L.rectangle([[proj4("EPSG:2154","EPSG:4326",[bbox[0],bbox[1]])[1], proj4("EPSG:2154","EPSG:4326",[bbox[0],bbox[1]])[0]], [proj4("EPSG:2154","EPSG:4326",[bbox[2],bbox[3]])[1], proj4("EPSG:2154","EPSG:4326",[bbox[2],bbox[3]])[0]]], {color: "#00d1b2", weight:1, fillOpacity:0.1}).addTo(map);
        }
    }
};
document.getElementById('file-input').onchange = handleFiles;
document.getElementById('folder-input').onchange = handleFiles;

function getZ(l93) {
    for (let m of layersStore) {
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const xP = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yP = (m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1]);
            return m.data[Math.floor(yP * m.image.getHeight()) * m.image.getWidth() + Math.floor(xP * m.image.getWidth())];
        }
    }
    return 0;
}

map.on('mousemove', (e) => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    document.getElementById('cur-z').textContent = getZ(l93).toFixed(2);
});
