// 1. Définition des projections (Exemple: Lambert 93 vers WGS84)
// Vous pourrez adapter 'EPSG:2154' selon vos données locales
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

// 2. Initialisation de la carte
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'satellite': {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                attribution: 'Esri'
            },
            'osm-topo': {
                type: 'raster',
                tiles: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: 'OSM'
            }
        },
        layers: [
            { id: 'layer-satellite', type: 'raster', source: 'satellite', layout: { visibility: 'visible' } },
            { id: 'layer-topo', type: 'raster', source: 'osm-topo', layout: { visibility: 'none' } }
        ]
    },
    center: [2.35, 48.85],
    zoom: 5
});

// 3. Gestion du changement de fond de carte
document.querySelectorAll('input[name="bg"]').forEach(input => {
    input.addEventListener('change', (e) => {
        const val = e.target.value;
        map.setLayoutProperty('layer-satellite', 'visibility', val === 'sat' ? 'visible' : 'none');
        map.setLayoutProperty('layer-topo', 'visibility', val === 'topo' ? 'visible' : 'none');
    });
});

// 4. Gestion de l'importation du dossier
document.getElementById('file-input').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    const listElement = document.getElementById('file-list');
    listElement.innerHTML = ''; // Réinitialise la liste

    // Filtrage
    const mntFiles = files.filter(f => f.name.toLowerCase().endsWith('.tif') || f.name.toLowerCase().endsWith('.tiff'));
    const lasFiles = files.filter(f => f.name.toLowerCase().endsWith('.las') || f.name.toLowerCase().endsWith('.laz'));

    // Affichage dans l'interface
    [...mntFiles, ...lasFiles].forEach(f => {
        const li = document.createElement('li');
        li.textContent = f.name;
        listElement.appendChild(li);
    });

    // Traitement des MNT
    for (const file of mntFiles) {
        await analyzeMNT(file);
    }
});

// 5. Fonction d'analyse d'une dalle MNT
async function analyzeMNT(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        
        // Récupère l'emprise (Bounding Box) du fichier
        const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
        
        // Conversion des coordonnées Lambert 93 (2154) vers GPS (WGS84)
        const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
        const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);

        console.log(`Dalle ${file.name} convertie :`, {sw, ne});

        // Zoomer sur la première dalle trouvée
        map.fitBounds([sw, ne], { padding: 50 });

        // TODO : Dessiner un rectangle sur la carte pour matérialiser la dalle
        
    } catch (e) {
        console.error("Erreur sur le fichier " + file.name, e);
    }
}
