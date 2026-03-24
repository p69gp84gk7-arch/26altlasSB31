<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>TopoProfiler Luchon Pro</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        :root { --accent: #00d1b2; }
        body { margin: 0; display: flex; height: 100vh; background: #1a1a1a; color: white; font-family: sans-serif; overflow: hidden; }
        #sidebar { width: 320px; padding: 20px; background: #252525; z-index: 1000; box-shadow: 5px 0 15px rgba(0,0,0,0.5); }
        #map { flex-grow: 1; background: #000; cursor: crosshair; }
        
        #coords-display { 
            position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.8); 
            padding: 15px; border-radius: 8px; z-index: 1000; border: 1px solid var(--accent);
            font-family: monospace; font-size: 14px; pointer-events: none;
        }
        
        #profile-popup {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 800px; height: 450px; background: white; color: black; border-radius: 10px;
            display: none; flex-direction: column; z-index: 3000; padding: 20px;
        }
        .btn { width: 100%; padding: 12px; margin: 5px 0; cursor: pointer; border: none; border-radius: 5px; font-weight: bold; }
        .btn-main { background: var(--accent); color: black; }
        .btn-draw { background: #f1c40f; }
    </style>
</head>
<body>

<div id="sidebar">
    <h2 style="color:var(--accent)">TopoProfiler</h2>
    <div style="background:#333; padding:10px; border-radius:5px; margin-bottom:15px;">
        <p style="font-size:0.8em; margin:0;">1. Importez vos .tif ou .shp<br>2. Cliquez sur Tracer<br>3. Double-cliquez pour finir</p>
    </div>
    <input type="file" id="file-input" multiple style="margin-bottom:10px;">
    <button id="btn-draw" class="btn btn-draw">📏 TRACER PROFIL</button>
    <button onclick="location.reload()" class="btn" style="background:#444; color:white;">🔄 RÉINITIALISER</button>
    <ul id="file-list" style="font-size:0.8em; color:var(--accent); padding-left:15px; margin-top:20px;"></ul>
</div>

<div id="map"></div>

<div id="coords-display">
    X (L93): <span id="cur-x">0.00</span> m<br>
    Y (L93): <span id="cur-y">0.00</span> m<br>
    <b>Alt (Z): <span id="cur-z" style="color:var(--accent)">0.00</span> m</b>
</div>

<div id="profile-popup">
    <div style="display:flex; justify-content:space-between; border-bottom:1px solid #ddd; padding-bottom:10px;">
        <h3 style="margin:0">Profil Altimétrique (m)</h3>
        <button onclick="document.getElementById('profile-popup').style.display='none'">&times;</button>
    </div>
    <div style="flex-grow:1"><canvas id="profileChart"></canvas></div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.11.0/proj4.js"></script>
<script src="https://cdn.jsdelivr.net/npm/geotiff"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://unpkg.com/shapefile@0.6.6/dist/shapefile.js"></script>
<script src="main.js"></script>
</body>
</html>
