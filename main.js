// --- INITIALISATION ---
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map', { doubleClickZoom: false }).setView([46.5, 2.5], 6);
const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' }).addTo(map);

let mntData = [];
let points = [];
let measureLine = null;
let chartInstance = null;

// --- GESTION DES IMPORTS ---
const handleFiles = async (e) => {
    const files = Array.from(e.target.files);
    
    // On regroupe les fichiers SHP car ils viennent par 3 (.shp, .dbf, .shx)
    const shpGroup = files.filter(f => f.name.toLowerCase().includes('.sh'));

    for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.tif') || name.endsWith('.tiff')) await loadMNT(file);
        if (name.endsWith('.shp')) await loadSHP(file, files.find(f => f.name.toLowerCase().endsWith('.dbf')));
    }
};

document.getElementById('folder-input').onchange = handleFiles;
document.getElementById('file-input').onchange = handleFiles;

async function loadMNT(file) {
    try {
        const buffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(buffer);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox();
        const raster = await image.readRasters();

        const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
        const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);

        L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color: "#00d1b2", weight: 1, fillOpacity: 0.15 }).addTo(map);
        addToList("MNT", file.name);
        mntData.push({ image, bbox, raster });
        map.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]]);
    } catch(err) { console.error(err); }
}

async function loadSHP(shpFile, dbfFile) {
    const shpBuf = await shpFile.arrayBuffer();
    const dbfBuf = dbfFile ? await dbfFile.arrayBuffer() : null;
    const source = await shapefile.open(shpBuf, dbfBuf);
    
    const geoLayer = L.geoJSON(null, { style: { color: "#ff4757", weight: 2 } }).addTo(map);
    while (true) {
        const result = await source.read();
        if (result.done) break;
        geoLayer.addData(result.value);
    }
    addToList("SHP", shpFile.name);
}

function addToList(type, name) {
    const li = document.createElement('li');
    li.textContent = `[${type}] ${name}`;
    document.getElementById('file-list').appendChild(li);
}

// --- CURSEUR TEMPS RÉEL (PRÉCISION) ---
map.on('mousemove', (e) => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    
    let z = getAlt(l93);
    document.getElementById('cur-z').textContent = z ? z.toFixed(3) : "---";
});

function getAlt(l93) {
    for (let m of mntData) {
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const xPct = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yPct = 1 - ((l93[1] - m.bbox[1]) / (m.bbox[3] - m.bbox[1]));
            const px = Math.floor(xPct * m.image.getWidth());
            const py = Math.floor(yPct * m.image.getHeight());
            const val = m.raster[0][py * m.image.getWidth() + px];
            return val > -1000 ? val : null;
        }
    }
    return null;
}

// --- MESURE & PROFIL ---
document.getElementById('btn-draw').onclick = () => {
    points = [];
    if (measureLine) map.removeLayer(measureLine);
    map.on('click', (e) => {
        points.push(e.latlng);
        if (measureLine) map.removeLayer(measureLine);
        measureLine = L.polyline(points, {color: '#f1c40f', weight: 4}).addTo(map);
        
        // Etiquette de distance sur le dernier segment
        if (points.length > 1) {
            const last = points[points.length-1];
            const prev = points[points.length-2];
            const d = last.distanceTo(prev);
            L.marker(last, { icon: L.divIcon({ className: 'dist-tag', html: `<b style="color:yellow; text-shadow:1px 1px black;">${d.toFixed(2)}m</b>` })}).addTo(map);
        }
    });
};

map.on('dblclick', () => {
    map.off('click');
    if (points.length > 1) {
        document.getElementById('profile-popup').style.display = 'flex';
        renderProfile();
    }
});

function renderProfile() {
    let data = [], totalDist = 0;
    for (let i = 0; i < points.length; i++) {
        if (i > 0) {
            // Calcul distance Euclidienne Lambert 93 pour précision centimétrique
            const p1 = proj4("EPSG:4326", "EPSG:2154", [points[i-1].lng, points[i-1].lat]);
            const p2 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
            totalDist += Math.sqrt(Math.pow(p2[0]-p1[0], 2) + Math.pow(p2[1]-p1[1], 2));
        }
        const l93 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
        data.push({ x: totalDist.toFixed(2), y: getAlt(l93) });
    }

    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Altitude Terrain (m)', data: data, borderColor: '#00d1b2', backgroundColor: 'rgba(0,209,178,0.1)', fill: true, tension: 0.2, pointRadius: 3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { 
                x: { type: 'linear', title: { display: true, text: 'Distance cumulée (m)' } },
                y: { title: { display: true, text: 'Altitude Z (m)' } }
            }
        }
    });
}

document.getElementById('btn-export').onclick = () => {
    const link = document.createElement('a');
    link.download = 'profil_centimetrique.png';
    link.href = document.getElementById('profileChart').toDataURL();
    link.click();
};
