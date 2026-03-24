// Config Lambert 93
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

// Initialisation Carte CENTRÉE SUR LUCHON
const map = L.map('map').setView([42.7905, 0.5912], 14);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri'
}).addTo(map);

let mntLayers = [];
let points = [];
let measureLine = null;
let chartInstance = null;

// GESTION FICHIERS
document.getElementById('file-input').onchange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
            await loadMNT(file);
        }
    }
};

async function loadMNT(file) {
    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox();
    const data = await image.readRasters();

    const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
    const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);

    L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], {
        color: "#00d1b2", weight: 2, fillOpacity: 0.1
    }).addTo(map);

    mntLayers.push({ image, bbox, data });
    document.getElementById('file-list').innerHTML += `<li>${file.name}</li>`;
    map.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]]);
}

// AFFICHAGE Z EN TEMPS RÉEL (CORRIGÉ)
map.on('mousemove', (e) => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    document.getElementById('cur-x').textContent = Math.round(l93[0]);
    document.getElementById('cur-y').textContent = Math.round(l93[1]);
    
    let z = 0;
    for (let m of mntLayers) {
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const xPct = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yPct = (m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1]); // Inversion Y pour le TIF
            const px = Math.floor(xPct * m.image.getWidth());
            const py = Math.floor(yPct * m.image.getHeight());
            z = m.data[0][py * m.image.getWidth() + px];
        }
    }
    document.getElementById('cur-z').textContent = z > -500 ? z.toFixed(2) : "0.00";
});

// TRACÉ
document.getElementById('btn-measure').onclick = () => {
    points = [];
    if (measureLine) map.removeLayer(measureLine);
    map.on('click', (e) => {
        points.push(e.latlng);
        if (measureLine) map.removeLayer(measureLine);
        measureLine = L.polyline(points, {color: '#f1c40f', weight: 3}).addTo(map);
    });
};

map.on('dblclick', () => {
    map.off('click');
    if (points.length > 1) drawProfile();
});

function drawProfile() {
    let profileData = [];
    let dist = 0;

    for (let i = 0; i < points.length; i++) {
        const l93 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
        if (i > 0) {
            const prevL93 = proj4("EPSG:4326", "EPSG:2154", [points[i-1].lng, points[i-1].lat]);
            dist += Math.sqrt(Math.pow(l93[0]-prevL93[0], 2) + Math.pow(l93[1]-prevL93[1], 2));
        }
        
        let z = 0;
        for (let m of mntLayers) {
            if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
                const xP = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
                const yP = (m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1]);
                z = m.data[0][Math.floor(yP * m.image.getHeight()) * m.image.getWidth() + Math.floor(xP * m.image.getWidth())];
            }
        }
        profileData.push({ x: dist.toFixed(2), y: z });
    }

    document.getElementById('profile-window').style.display = 'block';
    document.getElementById('btn-export').style.display = 'block';
    
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ label: 'Altitude (m)', data: profileData, borderColor: '#00d1b2', fill: true }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { type: 'linear', title: {display:true, text:'Distance (m)'} } }
        }
    });
}

document.getElementById('btn-export').onclick = () => {
    const link = document.createElement('a');
    link.download = 'profil.png';
    link.href = document.getElementById('profileChart').toDataURL();
    link.click();
};
