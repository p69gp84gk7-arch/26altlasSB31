proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map', { doubleClickZoom: false }).setView([42.7905, 0.5912], 14);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);

let mntData = [], measures = [], chartInstance = null, hoverMarker = null;
let currentDrawing = null, currentPoints = [];

// --- GESTION MNT ---
document.getElementById('file-input').onchange = e => handleFiles(e);
document.getElementById('folder-input').onchange = e => handleFiles(e);

async function handleFiles(e) {
    for (const file of e.target.files) {
        if (!file.name.match(/\.(tif|tiff)$/i)) continue;
        const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer());
        const image = await tiff.getImage();
        mntData.push({ bbox: image.getBoundingBox(), data: (await image.readRasters())[0], width: image.getWidth(), height: image.getHeight() });
    }
}

function getZ(l93) {
    for (let m of mntData) {
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const px = Math.floor(((l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0])) * m.width);
            const py = Math.floor(((m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1])) * m.height);
            return m.data[py * m.width + px] || 0;
        }
    } return 0;
}

// --- OUTILS DE MESURE ---
function initMeasure(type) {
    currentPoints = [];
    if(currentDrawing) map.removeLayer(currentDrawing);
    map.off('click').on('click', (e) => {
        currentPoints.push(e.latlng);
        if(currentDrawing) map.removeLayer(currentDrawing);
        currentDrawing = (type === 'line') ? L.polyline(currentPoints, {color:'#f1c40f', weight:3}).addTo(map) 
                                           : L.polygon(currentPoints, {color:'#e67e22', fillOpacity:0.2}).addTo(map);
    });
}

map.on('dblclick', () => {
    if (!currentDrawing) return;
    map.off('click');
    const id = Date.now();
    const type = (currentDrawing instanceof L.Polygon) ? 'surface' : 'ligne';
    
    const measureObj = { id, type, layer: currentDrawing, pts: [...currentPoints] };
    measures.push(measureObj);
    
    // Activer l'édition (via des marqueurs déplaçables)
    enableEditing(measureObj);
    updateUI();
    if(type === 'ligne') drawProfile(measureObj.pts);
    currentDrawing = null;
});

function enableEditing(m) {
    m.markers = L.layerGroup().addTo(map);
    m.pts.forEach((latlng, idx) => {
        const marker = L.circleMarker(latlng, {radius:6, color:'white', fillOpacity:1, draggable:true}).addTo(m.markers);
        
        // Evenement de déplacement
        marker.on('mousedown', () => {
            map.on('mousemove', (e) => {
                marker.setLatLng(e.latlng);
                m.pts[idx] = e.latlng;
                m.layer.setLatLngs(m.pts);
                updateUI();
                if(m.type === 'ligne') drawProfile(m.pts);
            });
        });
        map.on('mouseup', () => map.off('mousemove'));
    });
}

function updateUI() {
    const list = document.getElementById('measure-list');
    list.innerHTML = '';
    measures.forEach(m => {
        const ptsL93 = m.pts.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
        let info = "";

        if(m.type === 'ligne') {
            let d = 0; for(let i=1; i<ptsL93.length; i++) d += Math.sqrt(Math.pow(ptsL93[i][0]-ptsL93[i-1][0],2)+Math.pow(ptsL93[i][1]-ptsL93[i-1][1],2));
            const dz = getZ(ptsL93[ptsL93.length-1]) - getZ(ptsL93[0]);
            const pente = (d > 0) ? (Math.abs(dz)/d*100).toFixed(2) : 0;
            info = `Dist: ${d.toFixed(2)}m | Pente: ${pente}% | ΔZ: ${dz.toFixed(2)}m`;
        } else {
            let area = 0; for(let i=0; i<ptsL93.length; i++){ let j=(i+1)%ptsL93.length; area += ptsL93[i][0]*ptsL93[j][1] - ptsL93[j][0]*ptsL93[i][1]; }
            info = `Surf: ${(Math.abs(area)/2).toFixed(2)} m²`;
        }

        list.innerHTML += `<div class="measure-card"><button class="btn-del" onclick="deleteM(${m.id})">✕</button>
            <strong>${m.type.toUpperCase()}</strong><br><small>${info}</small></div>`;
    });
}

window.deleteM = (id) => {
    const m = measures.find(x => x.id === id);
    map.removeLayer(m.layer); map.removeLayer(m.markers);
    measures = measures.filter(x => x.id !== id);
    updateUI();
};

// --- PROFIL ALTIMÉTRIQUE ---
function drawProfile(pts) {
    document.getElementById('profile-window').style.display = 'block';
    const ptsL93 = pts.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    let data = [], totalD = 0, geoMap = [];

    const samples = 100;
    for(let i=0; i<=samples; i++) {
        const t = i/samples;
        // Interpolation entre tous les points de la multiligne
        const segment = Math.min(Math.floor(t * (pts.length-1)), pts.length-2);
        const localT = (t * (pts.length-1)) - segment;
        
        const x = ptsL93[segment][0] + (ptsL93[segment+1][0]-ptsL93[segment][0])*localT;
        const y = ptsL93[segment][1] + (ptsL93[segment+1][1]-ptsL93[segment][1])*localT;
        const z = getZ([x,y]);
        
        if(i>0) {
            const prev = data[i-1];
            totalD += Math.sqrt(Math.pow(x-ptsL93[segment][0],2)+Math.pow(y-ptsL93[segment][1],2)); // simplifié pour l'exemple
        }
        data.push({x: i, y: z}); // x est l'index pour fluidité
        geoMap.push(proj4("EPSG:2154","EPSG:4326",[x,y]));
    }

    if(chartInstance) chartInstance.destroy();
    chartInstance = new Chart(document.getElementById('profileChart'), {
        type:'line', data:{ datasets:[{label:'Altitude', data, borderColor:'#00d1b2', fill:true, pointRadius:0}] },
        options:{ 
            maintainAspectRatio:false, 
            onHover:(e, el) => {
                if(el.length > 0) {
                    const p = geoMap[el[0].index];
                    if(!hoverMarker) hoverMarker = L.circleMarker([p[1],p[0]], {color:'red', radius:5}).addTo(map);
                    else hoverMarker.setLatLng([p[1],p[0]]);
                }
            }
        }
    });
}

map.on('mousemove', e => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    document.getElementById('cur-z').textContent = getZ(l93).toFixed(2);
});
