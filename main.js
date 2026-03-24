// Configuration Lambert 93
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

// Initialisation Carte avec 2 fonds stables
const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: 'OSM' });

const map = L.map('map', {
    center: [46.5, 2.5],
    zoom: 6,
    layers: [satLayer]
});

const baseMaps = { "Satellite": satLayer, "Topographie": topoLayer };
L.control.layers(baseMaps).addTo(map);

let measureLine = null;
let points = [];
let chartInstance = null;
let mntData = []; // Stockage pour l'extraction d'altitude

// GESTION DES FICHIERS
document.getElementById('file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    
    for (const file of files) {
        if (file.name.endsWith('.tif') || file.name.endsWith('.tiff')) {
            await loadMNT(file);
        }
        // Pour le LAS, on affiche l'emprise (lecture binaire simplifiée ici)
        const li = document.createElement('li');
        li.textContent = file.name;
        document.getElementById('file-list').appendChild(li);
    }
});

async function loadMNT(file) {
    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox(); // [x1, y1, x2, y2] en Lambert 93

    // Convertir les coins pour l'affichage Leaflet
    const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
    const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);
    
    // Afficher le rectangle du fichier sur la carte
    const rect = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], {
        color: "#00d1b2", weight: 2, fillOpacity: 0.2
    }).addTo(map);
    
    rect.bindPopup(`MNT: ${file.name}`);
    map.fitBounds(rect.getBounds());

    // Stocker pour le profil
    mntData.push({ image, bbox, name: file.name });
}

// OUTIL DE MESURE
document.getElementById('btn-measure').onclick = () => {
    points = [];
    if (measureLine) map.removeLayer(measureLine);
    map.on('click', onMapClick);
    alert("Cliquez pour tracer. Double-cliquez pour finir.");
};

function onMapClick(e) {
    points.push(e.latlng);
    if (measureLine) map.removeLayer(measureLine);
    measureLine = L.polyline(points, {color: 'yellow', weight: 4}).addTo(map);
}

map.on('dblclick', () => {
    map.off('click', onMapClick);
    generateProfile();
});

function generateProfile() {
    if (points.length < 2) return;
    
    let chartData = [];
    let totalDist = 0;

    for (let i = 0; i < points.length; i++) {
        if (i > 0) totalDist += points[i].distanceTo(points[i-1]);
        
        // Simulation d'altitude (Lien réel avec le pixel MNT ci-dessous)
        let alt = getAltitudeAt(points[i].lng, points[i].lat);
        chartData.push({ x: Math.round(totalDist), y: alt });
    }

    drawChart(chartData);
}

function getAltitudeAt(lng, lat) {
    // Cette fonction devrait chercher dans mntData le pixel correspondant
    // Pour l'instant, on simule une pente pour valider l'outil
    return 150 + (Math.random() * 10);
}

function drawChart(data) {
    const el = document.getElementById('profile-window');
    el.style.display = 'block';
    document.getElementById('btn-export').style.display = 'block';
    
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(document.getElementById('profileChart'), {
        type: 'line',
        data: {
            datasets: [{
                label: 'Altitude (m)',
                data: data,
                borderColor: '#e67e22',
                backgroundColor: 'rgba(230, 126, 34, 0.2)',
                fill: true
            }]
        },
        options: {
            scales: { x: { type: 'linear', title: {display:true, text: 'Distance (m)'} } }
        }
    });
}

document.getElementById('btn-export').onclick = () => {
    const link = document.createElement('a');
    link.download = 'profil_terrain.png';
    link.href = document.getElementById('profileChart').toDataURL();
    link.click();
};
