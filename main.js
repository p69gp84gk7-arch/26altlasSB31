// --- CONFIGURATION ---
// Lambert 93 pour la précision centimétrique
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

// Initialisation de la carte centrée sur LUCHON
const map = L.map('map', { 
    doubleClickZoom: false 
}).setView([42.790, 0.591], 13); // Centrage Luchon

const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
    attribution: 'Esri' 
}).addTo(map);

let mntData = [];
let points = [];
let measureLine = null;
let chartInstance = null;

// --- GESTION DES FICHIERS ---
const handleFiles = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
            await loadMNT(file);
        }
    }
};

document.getElementById('folder-input').onchange = handleFiles;
document.getElementById('file-input').onchange = handleFiles;

async function loadMNT(file) {
    try {
        const buffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(buffer);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox(); // [xMin, yMin, xMax, yMax] en Lambert 93
        const raster = await image.readRasters();

        // Conversion des coins pour l'affichage Leaflet (GPS)
        const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
        const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);

        L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { 
            color: "#00d1b2", weight: 2, fillOpacity: 0.1 
        }).addTo(map);

        mntData.push({ image, bbox, raster });
        
        const li = document.createElement('li');
        li.textContent = "[MNT] " + file.name;
        document.getElementById('file-list').appendChild(li);

        console.log(`MNT Chargé : ${file.name}. Résolution: ${image.getWidth()}x${image.getHeight()}`);
    } catch(err) {
        console.error("Erreur de lecture MNT :", err);
        alert("Erreur sur le fichier : " + file.name);
    }
}

// --- AFFICHAGE Z ET COORDONNÉES ---
map.on('mousemove', (e) => {
    // 1. Conversion du curseur en Lambert 93
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    
    // 2. Recherche de l'altitude
    let z = getAltitudeAt(l93);
    document.getElementById('cur-z').textContent = z !== null ? z.toFixed(2) : "---";
});

function getAltitudeAt(l93) {
    for (let m of mntData) {
        // Vérifier si le point est dans la dalle
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const width = m.image.getWidth();
            const height = m.image.getHeight();
            
            // Calculer la position du pixel
            const xPct = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yPct = 1 - ((l93[1] - m.bbox[1]) / (m.bbox[3] - m.bbox[1]));
            
            const px = Math.floor(xPct * width);
            const py = Math.floor(yPct * height);
            
            // Extraction de la valeur (mètres)
            const val = m.raster[0][py * width + px];
            
            // Ignorer les valeurs de "NoData" (souvent -9999)
            return (val > -500 && val < 9000) ? val : null;
        }
    }
    return null;
}

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
        renderProfile();
    }
});

function renderProfile() {
    let profileData = [];
    let totalDist = 0;

    for (let i = 0; i < points.length; i++) {
        if (i > 0) {
            // Distance précise en Lambert 93
            const p1 = proj4("EPSG:4326", "EPSG:2154", [points[i-1].lng, points[i-1].lat]);
            const p2 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
            totalDist += Math.sqrt(Math.pow(p2[0]-p1[0], 2) + Math.pow(p2[1]-p1[1], 2));
        }
        
        const l93 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
        let alt = getAltitudeAt(l93);
        
        profileData.push({ x: totalDist.toFixed(2), y: alt });
    }

    // Affichage de la fenêtre
    document.getElementById('profile-popup').style.display = 'flex';
    
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Altitude (m)',
                data: profileData,
                borderColor: '#00d1b2',
                backgroundColor: 'rgba(0, 209, 178, 0.1)',
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Distance (m)' } },
                y: { title: { display: true, text: 'Z (m)' } }
            }
        }
    });
}
