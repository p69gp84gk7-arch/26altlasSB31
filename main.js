// Configuration Lambert 93
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

// Initialisation Carte
const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: 'OSM', subdomains: 'abc' });

const map = L.map('map', { center: [46.5, 2.5], zoom: 6, layers: [satLayer] });
L.control.layers({ "Satellite": satLayer, "Topographie": topoLayer }).addTo(map);

let points = [];
let measureLine = null;
let chartInstance = null;
let mntLayers = []; // Stockage MNT
let lasLayers = []; // Stockage LAS

// --- CHARGEMENT DES DOSSIERS ---
document.getElementById('file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.tif') || name.endsWith('.tiff')) {
            await processMNT(file);
        } else if (name.endsWith('.las') || name.endsWith('.laz')) {
            await processLAS(file);
        }
    }
});

async function processMNT(file) {
    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox();
    drawBounds(bbox, "#00d1b2", `MNT: ${file.name}`);
    mntLayers.push({ image, bbox, data: await image.readRasters() });
}

async function processLAS(file) {
    // Pour le LAS, on lit l'entête pour l'emprise
    const buffer = await file.arrayBuffer();
    const las = new LASJS.LAS(buffer);
    await las.populateHeader();
    const b = las.header.boundingBox;
    const bbox = [b.minX, b.minY, b.maxX, b.maxY];
    drawBounds(bbox, "#f1c40f", `LAS: ${file.name}`);
    lasLayers.push({ las, bbox });
}

function drawBounds(bbox, color, label) {
    const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
    const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);
    const rect = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color, weight: 2, fillOpacity: 0.1 }).addTo(map);
    rect.bindTooltip(label);
    map.fitBounds(rect.getBounds());
}

// --- MESURE ET PROFIL ---
document.getElementById('btn-measure').onclick = () => {
    points = [];
    if (measureLine) map.removeLayer(measureLine);
    map.on('click', (e) => {
        points.push(e.latlng);
        if (measureLine) map.removeLayer(measureLine);
        measureLine = L.polyline(points, {color: '#f1c40f', weight: 3, dashArray: '5, 10'}).addTo(map);
    });
};

map.on('dblclick', () => {
    map.off('click');
    generateSuperposedProfile();
});

async function generateSuperposedProfile() {
    let mntProfile = [], lasProfile = [], totalDist = 0;

    for (let i = 0; i < points.length; i++) {
        if (i > 0) totalDist += points[i].distanceTo(points[i-1]);
        
        const coordsL93 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
        
        // Extraction MNT
        let altMNT = extractMNTAltitude(coordsL93);
        mntProfile.push({ x: Math.round(totalDist), y: altMNT });

        // Extraction LAS (on simule un léger bruit au-dessus du MNT pour l'exemple)
        lasProfile.push({ x: Math.round(totalDist), y: altMNT + (Math.random() * 5) });
    }
    renderChart(mntProfile, lasProfile);
}

function extractMNTAltitude(l93) {
    for (let m of mntLayers) {
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const xPct = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yPct = 1 - ((l93[1] - m.bbox[1]) / (m.bbox[3] - m.bbox[1]));
            const px = Math.floor(xPct * m.image.getWidth());
            const py = Math.floor(yPct * m.image.getHeight());
            return m.data[0][py * m.image.getWidth() + px];
        }
    }
    return null;
}

function renderChart(mntData, lasData) {
    document.getElementById('profile-window').style.display = 'block';
    document.getElementById('btn-export').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'MNT (Sol)',
                    data: mntData,
                    borderColor: '#00d1b2',
                    borderWidth: 3,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'LAS (Points bruts)',
                    data: lasData,
                    borderColor: '#f1c40f',
                    borderDash: [5, 5],
                    pointRadius: 2,
                    showLine: false, // On affiche des points pour le LAS
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { type: 'linear' }, y: { beginAtZero: false } }
        }
    });
}
