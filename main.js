<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>TopoProfiler v6 - Bagnères-de-Luchon</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        :root { --accent: #00d1b2; --panel: #252525; }
        body { margin: 0; display: flex; height: 100vh; background: #1a1a1a; color: white; font-family: sans-serif; overflow: hidden; }
        
        #sidebar-left { width: 260px; padding: 15px; background: var(--panel); border-right: 1px solid #444; }
        #map { flex-grow: 1; position: relative; }
        #sidebar-right { width: 300px; padding: 15px; background: var(--panel); border-left: 1px solid #444; overflow-y: auto; }

        .section-title { color: var(--accent); font-size: 0.8em; font-weight: bold; margin: 15px 0 10px 0; border-bottom: 1px solid #444; }
        .tool-btn { width: 100%; padding: 10px; margin: 4px 0; background: #333; color: white; border: 1px solid #555; border-radius: 4px; cursor: pointer; text-align: left; }
        .tool-btn:hover { border-color: var(--accent); }
        .tool-btn.active { background: var(--accent); color: black; font-weight: bold; }

        #profile-window { 
            position: absolute; bottom: 10px; left: 275px; right: 315px; 
            height: 240px; background: white; border-radius: 8px; padding: 10px; z-index: 2000; 
            display: none; box-shadow: 0 -5px 15px rgba(0,0,0,0.5); 
        }

        .layer-item, .measure-card { background: #111; padding: 8px; margin-bottom: 8px; border-radius: 4px; border-left: 3px solid var(--accent); position: relative; font-size: 0.85em; }
        .btn-del { position: absolute; top: 5px; right: 5px; color: #ff4757; background: none; border: none; cursor: pointer; }
        
        .coords-box { background: #000; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 0.85em; margin-top: 20px; }
        .export-group { display: flex; gap: 5px; margin-top: 10px; }
        .btn-exp { flex: 1; padding: 5px; font-size: 0.75em; background: #3498db; color: white; border: none; border-radius: 3px; cursor: pointer; }
    </style>
</head>
<body>

    <div id="sidebar-left">
        <h3 style="color:var(--accent)">TopoProfiler</h3>
        <div class="section-title">Importation MNT</div>
        <input type="file" id="file-input" webkitdirectory directory multiple style="width:100%; font-size:0.8em;">
        <p style="font-size:0.7em; color:#777;">Sélectionnez un fichier ou un dossier complet.</p>
        
        <div class="section-title">Gestion des MNT</div>
        <div id="layer-manager"></div>
    </div>

    <div id="map"></div>

    <div id="sidebar-right">
        <div class="section-title">Outils</div>
        <button id="btn-line" class="tool-btn" onclick="setMode('line')">📏 Ligne (2 pts) + Pente</button>
        <button id="btn-mline" class="tool-btn" onclick="setMode('mline')">👣 Multi-points + Profil</button>
        <button id="btn-area" class="tool-btn" onclick="setMode('area')">📐 Surface (m²)</button>
        
        <div class="section-title">Mesures en mémoire</div>
        <div id="measure-list"></div>

        <div class="section-title">Export global</div>
        <div class="export-group">
            <button class="btn-exp" onclick="window.print()">Imprimer Vue</button>
            <button class="btn-exp" onclick="exportAllCSV()">Données CSV</button>
        </div>

        <div class="coords-box">
            X: <span id="cur-x">0.00</span> | Y: <span id="cur-y">0.00</span><br>
            Z: <span id="cur-z" style="color:var(--accent); font-weight:bold;">0.00</span> m
        </div>
    </div>

    <div id="profile-window">
        <div style="display:flex; justify-content:space-between; color:black; margin-bottom:5px; align-items:center;">
            <strong>Profil du terrain</strong>
            <button onclick="document.getElementById('profile-window').style.display='none'" style="background:#eee; border:1px solid #ccc; cursor:pointer;">Fermer</button>
        </div>
        <div style="height:190px;"><canvas id="profileChart"></canvas></div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.11.0/proj4.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/geotiff"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="main.js"></script>
</body>
</html>
