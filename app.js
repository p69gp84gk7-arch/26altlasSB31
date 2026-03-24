// Initialisation de la carte
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'satellite-tiles': {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                attribution: 'Esri, Maxar, Earthstar Geographics'
            },
            'osm-tiles': {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap contributors'
            }
        },
        layers: [
            { id: 'satellite', type: 'raster', source: 'satellite-tiles', layout: { visibility: 'visible' } },
            { id: 'osm', type: 'raster', source: 'osm-tiles', layout: { visibility: 'none' } }
        ]
    },
    center: [2.35, 48.85], // Position par défaut (Paris)
    zoom: 5
});

// --- Gestion du changement de fond de carte ---
document.querySelectorAll('input[name="basemap"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const selected = e.target.value;
        map.setLayoutProperty('satellite', 'visibility', selected === 'satellite' ? 'visible' : 'none');
        map.setLayoutProperty('osm', 'visibility', selected === 'osm' ? 'visible' : 'none');
    });
});

// --- Gestion de l'import de fichiers ---
document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    console.log("Fichier détecté :", file.name);
    
    // ICI : Ajouter la logique de lecture (geotiff.js ou laszip.js)
    // 1. Lire les métadonnées pour zoomer sur le fichier
    // 2. Transformer les données en couche 'Canvas' ou 'GeoJSON' pour l'affichage
});
