proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map').setView([46.5, 2.5], 6);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' }).addTo(map);

let mntLayers = [];
let points = [];
let measureLine = null;

// --- GESTION DU DRAG & DROP ---
const dropZone = document.getElementById('drop-zone');

dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('hover'); };
dropZone.ondragleave = () => { dropZone.classList.remove('hover'); };
dropZone.ondrop = async (e) => {
    e.preventDefault();
    dropZone.classList.remove('hover');
    const items = e.dataTransfer.items;
    let files = [];
    for (let item of items) {
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry();
            if (entry.isDirectory) {
                // Pour gérer les dossiers réels via Drag & Drop, il faut une récursion.
                // Pour faire simple ici, on demande d'utiliser le bouton si c'est un dossier complexe.
                alert("Pour les dossiers, utilisez le bouton 'Choisir un dossier'");
            } else {
                files.push(item.getAsFile());
            }
        }
    }
    handleFiles(files);
};

// --- GESTION DU BOUTON ---
document.getElementById('file-input').onchange = (e) => handleFiles(Array.from(e.target.files));

async function handleFiles(files) {
    const list = document.getElementById('file-list');
    console.log(`Tentative d'import de ${files.length} fichiers...`);

    for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.tif') || name.endsWith('.tiff')) {
            const li = document.createElement('li');
            li.textContent = "Chargement : " + file.name;
            list.appendChild(li);
            
            try {
                const buffer = await file.arrayBuffer();
                const tiff = await GeoTIFF.fromArrayBuffer(buffer);
                const image = await tiff.getImage();
                const bbox = image.getBoundingBox();
                const data = await image.readRasters();

                // Conversion pour affichage
                const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
                const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);

                const rect = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], {
                    color: "#00d1b2", weight: 2, fillOpacity: 0.3
                }).addTo(map);
                
                mntLayers.push({ image, bbox, data });
                li.style.color = "#f1c40f"; // Succès
                li.textContent = "Prêt : " + file.name;
                map.fitBounds(rect.getBounds());
            } catch (err) {
                console.error("Erreur sur " + file.name, err);
                li.style.color = "red";
                li.textContent = "Erreur : " + file.name;
            }
        }
    }
}

// --- MESURE ---
document.getElementById('btn-measure').onclick = () => {
    points = [];
    if (measureLine) map.removeLayer(measureLine);
    map.on('click', (e) => {
        points.push(e.latlng);
        if (measureLine) map.removeLayer(measureLine);
        measureLine = L.polyline(points, {color: 'yellow', weight: 4}).addTo(map);
    });
};

map.on('dblclick', () => {
    map.off('click');
    if (points.length > 1) {
        document.getElementById('profile-window').style.display = 'block';
        // ... (Reste du code Chart.js identique au précédent)
    }
});
