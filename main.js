// Configuration Lambert 93
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

// Initialisation de la carte avec Leaflet
const map = L.map('map').setView([46.5, 2.5], 6);

const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri'
}).addTo(map);

const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'OpenTopoMap'
});

L.control.layers({ "Satellite": sat, "Topographie": topo }).addTo(map);

let mntData = [];
let points = [];
let measureLine = null;
let chartInstance = null;

// GESTION DES FICHIERS
document.getElementById('file-input').onchange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        if (file.name.toLowerCase().endsWith('.tif')) {
            await loadMNT(file);
        }
    }
};

async function loadMNT(file) {
    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox(); // Lambert 93

    // Conversion pour affichage Leaflet (GPS)
    const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
    const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);

    const rect = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], {
        color: "#00d1b2", weight: 2, fillOpacity: 0.2
    }).addTo(map);

    const li = document.createElement('li');
    li.textContent = file.name;
    document.getElementById('file-names').appendChild(li);

    mntData.push({ image, bbox, raster: await image.readRasters() });
    map.fitBounds(rect.getBounds());
}

// OUTIL DE TRACÉ
document.getElementById('btn-draw').onclick = () => {
    points = [];
    if (measureLine) map.removeLayer(measureLine);
    map.on('click', (e) => {
        points.push(e.latlng);
        if (measureLine) map.removeLayer(measureLine);
        measureLine = L.polyline(points, {color: '#f1c40f', weight: 4}).addTo(map);
    });
};

map.on('dblclick', () => {
    map.off('click');
    if (points.length > 1) generateProfile();
});

function generateProfile() {
    let dataset = [];
    let totalDist = 0;

    for (let i = 0; i < points.length; i++) {
        if (i > 0) totalDist += points[i].distanceTo(points[i-1]);
        
        const l93 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
        let z = 0;
        
        // Chercher l'altitude dans les dalles chargées
        for (let m of mntData) {
            if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
                const xPct = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
                const yPct = 1 - ((l93[1] - m.bbox[1]) / (m.bbox[3] - m.bbox[1]));
                const px = Math.floor(xPct * m.image.getWidth());
                const py = Math.floor(yPct * m.image.getHeight());
                z = m.raster[0][py * m.image.getWidth() + px];
            }
        }
        dataset.push({ x: Math.round(totalDist), y: z });
    }

    showChart(dataset);
}

function showChart(data) {
    document.getElementById('profile-container').style.display = 'block';
    document.getElementById('btn-export').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ label: 'Profil Terrain (m)', data: data, borderColor: '#00d1b2', fill: true, backgroundColor: 'rgba(0,209,178,0.1)' }]
        },
        options: { scales: { x: { type: 'linear' } } }
    });
}

document.getElementById('btn-export').onclick = () => {
    const link = document.createElement('a');
    link.download = 'profil.png';
    link.href = document.getElementById('profileChart').toDataURL();
    link.click();
};
