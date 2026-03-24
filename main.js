// Définition Lambert 93
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

// --- INITIALISATION CARTE ---
// Coordonnées Bagnères-de-Luchon : Lat 42.79, Lon 0.59
const map = L.map('map', { 
    center: [42.7905, 0.5912], 
    zoom: 14,
    doubleClickZoom: false 
});

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri Satellite'
}).addTo(map);

let mntData = [];
let points = [];
let measureLine = null;
let chartInstance = null;

// --- GESTION DES FICHIERS ---
document.getElementById('file-input').onchange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.tif') || name.endsWith('.tiff')) {
            await loadMNT(file);
        } else if (name.endsWith('.shp')) {
            await loadSHP(file);
        }
    }
};

async function loadMNT(file) {
    try {
        const buffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(buffer);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox(); // Lambert 93
        const raster = await image.readRasters();

        // Ajout à la base de données locale
        mntData.push({ image, bbox, raster });

        // Affichage emprise
        const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
        const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);
        L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color: "#00d1b2", weight: 2, fillOpacity: 0.1 }).addTo(map);
        
        const li = document.createElement('li');
        li.textContent = "MNT: " + file.name;
        document.getElementById('file-list').appendChild(li);

        // Zoomer sur la donnée
        map.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]]);
    } catch(err) { console.error(err); }
}

// --- LOGIQUE D'EXTRACTION Z (MÈTRES) ---
map.on('mousemove', (e) => {
    // Conversion curseur GPS -> Lambert 93
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    
    let altitude = null;

    // On cherche dans les dalles MNT chargées
    for (let m of mntData) {
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const width = m.image.getWidth();
            const height = m.image.getHeight();
            
            // Calcul position pixel précise
            const xPct = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yPct = (m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1]); // Inversion Y corrigée
            
            const px = Math.floor(xPct * width);
            const py = Math.floor(yPct * height);
            
            if (px >= 0 && px < width && py >= 0 && py < height) {
                const val = m.raster[0][py * width + px];
                if (val > -500 && val < 9000) altitude = val;
            }
        }
    }
    document.getElementById('cur-z').textContent = altitude ? altitude.toFixed(2) : "0.00";
});

// --- TRACÉ ET PROFIL ---
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
    if (points.length > 1) {
        showProfile();
    }
});

function showProfile() {
    let data = [], totalD = 0;
    for (let i = 0; i < points.length; i++) {
        const l93 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
        if (i > 0) {
            const prevL93 = proj4("EPSG:4326", "EPSG:2154", [points[i-1].lng, points[i-1].lat]);
            totalD += Math.sqrt(Math.pow(l93[0]-prevL93[0], 2) + Math.pow(l93[1]-prevL93[1], 2));
        }
        
        // Récupérer Z pour le graphique
        let z = 0;
        for (let m of mntData) {
            if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
                const xP = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
                const yP = (m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1]);
                z = m.raster[0][Math.floor(yP * m.image.getHeight()) * m.image.getWidth() + Math.floor(xP * m.image.getWidth())];
            }
        }
        data.push({ x: totalD.toFixed(2), y: z });
    }

    document.getElementById('profile-popup').style.display = 'flex';
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ label: 'Altitude (m)', data: data, borderColor: '#00d1b2', fill: true }]
        },
        options: { scales: { x: { type: 'linear' } } }
    });
}
