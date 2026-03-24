const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'satellite': {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256
            },
            'opentopo': {
                type: 'raster',
                tiles: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                subdomains: 'abc'
            }
        },
        layers: [
            { id: 'layer-satellite', type: 'raster', source: 'satellite', layout: { visibility: 'visible' } },
            { id: 'layer-topo', type: 'raster', source: 'opentopo', layout: { visibility: 'none' } }
        ]
    },
    center: [2.35, 48.85],
    zoom: 12
});

// Switcher de fond de carte
document.querySelectorAll('input[name="bg"]').forEach(input => {
    input.addEventListener('change', (e) => {
        const val = e.target.value;
        map.setLayoutProperty('layer-satellite', 'visibility', val === 'sat' ? 'visible' : 'none');
        map.setLayoutProperty('layer-topo', 'visibility', val === 'topo' ? 'visible' : 'none');
    });
});
