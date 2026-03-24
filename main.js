// Configuration Lambert 93
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

// Initialisation Carte (centrée Luchon)
const map = L.map('map', { doubleClickZoom: false }).setView([42.7905, 0.5912], 14);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20,
    attribution: 'Esri Satellite'
}).addTo(map);

let mntLayers = [];
let measures = [];
let chartInstance = null;
let tempPoints = [];
let tempDrawing = null;
let hoverMarker = null;

// --- GESTION DES FICHIERS ---
const inputHandler = async (e) => {
    for (const file of e.target.files) {
        if (!file.name.toLowerCase().endsWith('.tif') && !file.name.toLowerCase().endsWith('.tiff')) continue;
        const buffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(buffer);
        const image = await tiff.getImage();
        mntLayers.push({
            bbox: image.getBoundingBox(),
            data: (await image.readRasters())[0],
            width: image.getWidth(),
            height: image.getHeight()
        });
        console.log("MNT Chargé : " + file.name);
    }
};
document.getElementById('file-input').onchange = inputHandler;
document.getElementById('folder-input').onchange = inputHandler;

// --- LECTURE ALTITUDE Z ---
function getZ(l93) {
    for (let m of mntLayers) {
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const xPct = (l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0]);
            const yPct = (m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1]);
            const px = Math.floor(xPct * m.width);
            const py = Math.floor(yPct * m.height);
            const val = m.data[py * m.width + px];
            if (val !== undefined && val > -500) return val;
        }
    }
    return null;
}

// --- DESSIN ET MESURE ---
function startDrawing(type) {
    tempPoints = [];
    if (tempDrawing) map.removeLayer(tempDrawing);
    map.off('click').on('click', (e) => {
        tempPoints.push(e.latlng);
        if (tempDrawing) map.removeLayer(tempDrawing);
        
        const style = type === 'line' ? { color: '#f1c40f', weight: 5 } : { color: '#e67e22', fillOpacity: 0.3 };
        tempDrawing = type === 'line' ? L.polyline(tempPoints, style).addTo(map) : L.polygon(tempPoints, style).addTo(map);
    });
}

map.on('dblclick', () => {
    if (tempPoints.length < 2) return;
    map.off('click');
    const type = (tempDrawing instanceof L.Polygon) ? 'surface' : 'ligne';
    const measure = {
        id: Date.now(),
        type: type,
        pts: [...tempPoints],
        layer: tempDrawing,
        markers: L.layerGroup().addTo(map)
    };
    measures.push(measure);
    createEditMarkers(measure);
    updateInterface();
    if (type === 'ligne') drawProfile(measure.pts);
    tempDrawing = null;
    tempPoints = [];
});

// --- ÉDITION DES POINTS ---
function createEditMarkers(m) {
    m.markers.clearLayers();
    m.pts.forEach((latlng, idx) => {
        const marker = L.circleMarker(latlng, { radius: 6, color: 'white', fillColor: '#00d1b2', fillOpacity: 1, weight: 2, interactive: true }).addTo(m.markers);
        
        marker.on('mousedown', () => {
            map.dragging.disable();
            map.on('mousemove', (e) => {
                marker.setLatLng(e.latlng);
                m.pts[idx] = e.latlng;
                m.layer.setLatLngs(m.pts);
                updateInterface();
                if (m.type === 'ligne') drawProfile(m.pts);
            });
        });

        map.on('mouseup', () => {
            map.dragging.enable();
            map.off('mousemove');
        });
    });
}

// --- CALCULS ET INTERFACE ---
function updateInterface() {
    const list = document.getElementById('measure-list');
    list.innerHTML = '';
    
    measures.forEach(m => {
        const ptsL93 = m.pts.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
        let resultHtml = "";

        if (m.type === 'ligne') {
            let dist = 0;
            for (let i = 1; i < ptsL93.length; i++) {
                dist += Math.sqrt(Math.pow(ptsL93[i][0] - ptsL93[i-1][0], 2) + Math.pow(ptsL93[i][1] - ptsL93[i-1][1], 2));
            }
            const z1 = getZ(ptsL93[0]) || 0;
            const z2 = getZ(ptsL93[ptsL93.length - 1]) || 0;
            const slope = dist > 0 ? (Math.abs(z2 - z1) / dist * 100).toFixed(2) : 0;
            resultHtml = `Dist : <b>${dist.toFixed(2)}m</b><br>Pente : <b>${slope}%</b> | ΔZ : <b>${(z2-z1).toFixed(2)}m</b>`;
        } else {
            let area = 0;
            for (let i = 0; i < ptsL93.length; i++) {
                let j = (i + 1) % ptsL93.length;
                area += ptsL93[i][0] * ptsL93[j][1] - ptsL93[j][0] * ptsL93[i][1];
            }
            resultHtml = `Surface : <b>${(Math.abs(area) / 2).toFixed(2)} m²</b>`;
        }

        const card = document.createElement('div');
        card.className = 'measure-card';
        card.innerHTML = `<button class="btn-del" onclick="deleteMeasure(${m.id})">✕</button>
                          <strong>${m.type.toUpperCase()}</strong><br>${resultHtml}`;
        list.appendChild(card);
    });
}

window.deleteMeasure = (id) => {
    const m = measures.find(x => x.id === id);
    map.removeLayer(m.layer);
    map.removeLayer(m.markers);
    measures = measures.filter(x => x.id !== id);
    updateInterface();
};

// --- PROFIL ALTIMÉTRIQUE ---
function drawProfile(pts) {
    document.getElementById('profile-window').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    
    let profileData = [];
    let geoRef = [];
    const samples = 100;
    
    const p1 = proj4("EPSG:4326", "EPSG:2154", [pts[0].lng, pts[0].lat]);
    const p2 = proj4("EPSG:4326", "EPSG:2154", [pts[pts.length-1].lng, pts[pts.length-1].lat]);
    const totalD = Math.sqrt(Math.pow(p2[0]-p1[0],2)+Math.pow(p2[1]-p1[1],2));

    for (let i = 0; i <= samples; i++) {
        const ratio = i / samples;
        const x = p1[0] + (p2[0] - p1[0]) * ratio;
        const y = p1[1] + (p2[1] - p1[1]) * ratio;
        const z = getZ([x, y]);
        profileData.push({ x: (ratio * totalD).toFixed(1), y: z });
        geoRef.push(proj4("EPSG:2154", "EPSG:4326", [x, y]));
    }

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ label: 'Altitude (m)', data: profileData, borderColor: '#00d1b2', backgroundColor: 'rgba(0,209,178,0.1)', fill: true, pointRadius: 0, tension: 0.1 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { type: 'linear', title: { display: true, text: 'Distance (m)' } } },
            onHover: (event, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const pos = geoRef[idx];
                    if (!hoverMarker) hoverMarker = L.circleMarker([pos[1], pos[0]], { radius: 7, color: 'red', fillColor: 'white', fillOpacity: 1 }).addTo(map);
                    else hoverMarker.setLatLng([pos[1], pos[0]]);
                }
            }
        }
    });
}

// Suivi Souris
map.on('mousemove', (e) => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    const z = getZ(l93);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    document.getElementById('cur-z').textContent = z !== null ? z.toFixed(2) : "0.00";
});
