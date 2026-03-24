proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map').setView([46.5, 2.5], 6);
const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' }).addTo(map);

let mntLayers = [];
let lasLayers = [];
let points = [];
let measureLine = null;
let chartInstance = null;

// --- GESTION DES FICHIERS ---
document.getElementById('folder-input').onchange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.tif') || name.endsWith('.tiff')) {
            await addLayer(file, 'mnt');
        } else if (name.endsWith('.las') || name.endsWith('.laz')) {
            await addLayer(file, 'las');
        }
    }
};

async function addLayer(file, type) {
    try {
        const buffer = await file.arrayBuffer();
        let bbox, data, image;

        if (type === 'mnt') {
            const tiff = await GeoTIFF.fromArrayBuffer(buffer);
            image = await tiff.getImage();
            bbox = image.getBoundingBox();
            data = await image.readRasters();
            mntLayers.push({ name: file.name, image, bbox, data });
        } else {
            // Simulation LAS pour l'emprise (nécessite las-js pour lecture complète)
            bbox = [700000, 6600000, 701000, 6601000]; // Exemple Lambert 93
            lasLayers.push({ name: file.name, bbox });
        }

        const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
        const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);
        
        const color = type === 'mnt' ? '#00d1b2' : '#f1c40f';
        L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color, weight: 1 }).addTo(map);

        const item = document.createElement('div');
        item.className = 'layer-item';
        item.innerHTML = `<span>${file.name}</span><input type="checkbox" checked>`;
        document.getElementById(`list-${type}`).appendChild(item);
        
        map.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]]);
    } catch(err) { console.error(err); }
}

// --- PROFIL EN LONG ---
document.getElementById('btn-draw').onclick = () => {
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
    if (points.length > 1) {
        document.getElementById('profile-popup').style.display = 'flex';
        calculateProfiles();
    }
});

function calculateProfiles() {
    let mntDataset = [], lasDataset = [], totalDist = 0;

    for (let i = 0; i < points.length; i++) {
        if (i > 0) totalDist += points[i].distanceTo(points[i-1]);
        const l93 = proj4("EPSG:4326", "EPSG:2154", [points[i].lng, points[i].lat]);
        
        // Calcul MNT
        let zMNT = 0;
        for (let m of mntLayers) {
            if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
                const xPct = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
                const yPct = 1 - ((l93[1] - m.bbox[1]) / (m.bbox[3] - m.bbox[1]));
                const px = Math.floor(xPct * m.image.getWidth());
                const py = Math.floor(yPct * m.image.getHeight());
                zMNT = m.data[0][py * m.image.getWidth() + px];
            }
        }
        mntDataset.push({ x: Math.round(totalDist), y: zMNT });
        // Simu LAS (MNE) : on ajoute 2m à 10m de végétation aléatoire
        lasDataset.push({ x: Math.round(totalDist), y: zMNT + (Math.random() * 8) });
    }
    renderMultiChart(mntDataset, lasDataset);
}

function renderMultiChart(mnt, las) {
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                { label: 'Sol (MNT)', data: mnt, borderColor: '#00d1b2', backgroundColor: 'rgba(0,209,178,0.2)', fill: true, tension: 0.1 },
                { label: 'Sur-sol (LAS/MNE)', data: las, borderColor: '#f1c40f', borderDash: [5,5], pointRadius: 0, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { type: 'linear', title: {display:true, text:'Distance (m)'} }, y: { title: {display:true, text:'Altitude (m)'} } }
        }
    });
}

document.getElementById('btn-export').onclick = () => {
    const link = document.createElement('a');
    link.download = 'profil_ign_style.png';
    link.href = document.getElementById('profileChart').toDataURL();
    link.click();
};
