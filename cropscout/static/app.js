// Global variables
let map, droneMarker, currentRoute = {waypoints: []};
let routePolyline, waypointMarkers = [];
let token = localStorage.getItem('auth_token');
let selectedRouteId = null;
let isDroneInMotion = false;
let mapLayer, satelliteLayer;
let terrainChart = null;
let pendingWaypointLocation = null;
let missionCancelled = false;

const ELEVATION_API_URL = 'https://api.open-elevation.com/api/v1/lookup';

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log('Authentication disabled for demo purposes');
    if (!token) {
        fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({username: 'admin', password: 'admin'})
        })
            .then(response => response.json())
            .then(data => {
                token = data.access_token;
                localStorage.setItem('auth_token', data.access_token);
            })
            .catch(error => {
                console.error('Auto-login error:', error);
                setupLoginForm();
            });
    }

    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('appContainer').style.display = 'grid';
    initializeMap();
    loadSavedRoutes();
    setupEventListeners();
});

// Initialize Leaflet map
function initializeMap() {
    // Create map centered at specified location
    map = L.map('map', {attributionControl: false}).setView([39.723869, -75.570324], 16);

    L.control.attribution({
        prefix: 'Leaflet'
    }).addTo(map);

    // Define map layers
    mapLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    });

    satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; <a href="https://www.esri.com/en-us/home">Esri</a>',
        maxZoom: 19
    });

    // Default to satellite view
    satelliteLayer.addTo(map);

    // Add click listener for adding waypoints
    map.on('contextmenu', function (e) {
        pendingWaypointLocation = e.latlng;
        fetchTerrainData(e.latlng);
    });
}

// Setup all event listeners for UI interactions
function setupEventListeners() {
    // User menu dropdown toggle
    document.getElementById('userMenuBtn').addEventListener('click', () => {
        document.getElementById('userDropdown').classList.toggle('show');
    });

    // Close dropdown when clicking outside
    window.addEventListener('click', (e) => {
        if (!e.target.matches('.user-menu-button') && !e.target.matches('#userMenuBtn i') && !e.target.matches('#userMenuBtn span')) {
            const dropdown = document.getElementById('userDropdown');
            if (dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
            }
        }
    });

    // Save route button
    document.getElementById('saveRouteBtn').addEventListener('click', saveCurrentRoute);

    // Clear route button
    document.getElementById('clearRouteBtn').addEventListener('click', clearCurrentRoute);

    // Start mission button
    document.getElementById('startMissionBtn').addEventListener('click', startMission);

    // Change password button
    document.getElementById('changePasswordBtn').addEventListener('click', () => {
        document.getElementById('changePasswordModal').classList.add('show');
    });

    // Cancel change password button
    document.getElementById('cancelChangePassword').addEventListener('click', () => {
        document.getElementById('changePasswordModal').classList.remove('show');
        document.getElementById('changePasswordForm').reset();
    });

    // Change password form submission
    document.getElementById('changePasswordForm').addEventListener('submit', changePassword);

    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Map/Satellite toggle buttons
    document.getElementById('mapViewBtn').addEventListener('click', () => {
        map.removeLayer(satelliteLayer);
        mapLayer.addTo(map);
        document.getElementById('mapViewBtn').classList.add('active');
        document.getElementById('satelliteViewBtn').classList.remove('active');
    });

    document.getElementById('satelliteViewBtn').addEventListener('click', () => {
        map.removeLayer(mapLayer);
        satelliteLayer.addTo(map);
        document.getElementById('satelliteViewBtn').classList.add('active');
        document.getElementById('mapViewBtn').classList.remove('active');
    });

    // Terrain modal buttons
    document.getElementById('cancelAltitude').addEventListener('click', () => {
        document.getElementById('terrainModal').style.display = 'none';
        pendingWaypointLocation = null;
    });

    document.getElementById('confirmAltitude').addEventListener('click', () => {
        if (pendingWaypointLocation) {
            const altitude = parseFloat(document.getElementById('altitudeValue').innerText);
            pendingWaypointLocation.alt = altitude;
            addWaypoint(pendingWaypointLocation);
            document.getElementById('terrainModal').style.display = 'none';
            pendingWaypointLocation = null;
        }
    });

    // Altitude slider
    document.getElementById('altitudeSlider').addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        document.getElementById('altitudeValue').innerText = value.toFixed(1) + ' m';
    });

    // Display username
    const payload = parseJwt(token);
    if (payload && payload.sub) {
        document.getElementById('usernameDisplay').textContent = payload.sub;
    }
}

// Setup login form functionality
function setupLoginForm() {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({username, password})
            });

            if (response.ok) {
                const data = await response.json();
                token = data.access_token;
                localStorage.setItem('auth_token', token);

                document.getElementById('loginContainer').style.display = 'none';
                document.getElementById('appContainer').style.display = 'grid';

                initializeMap();
                loadSavedRoutes();
                setupEventListeners();
            } else {
                alert('Login failed. Please check your credentials.');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('Login failed due to a server error.');
        }
    });
}

// Fetch terrain elevation data for a location
async function fetchTerrainData(latlng) {
    try {
        // Show loading state in the terrain modal
        document.getElementById('terrainModal').style.display = 'flex';
        document.getElementById('terrainChart').innerHTML = 'Loading terrain data...';

        // Calculate a grid of points around the clicked location for terrain profile
        const points = generateTerrainSamplePoints(latlng, 20, 5);

        // Fetch elevation data for all points
        const response = await fetch(ELEVATION_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                locations: points
            })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch elevation data');
        }

        const data = await response.json();
        const elevations = data.results.map(point => point.elevation);

        // Calculate minimum, recommended and safe altitudes
        const minElevation = Math.max(...elevations);
        const avgElevation = elevations.reduce((a, b) => a + b, 0) / elevations.length;
        const recommendedAlt = Math.max(minElevation + 2, avgElevation);
        const safeAlt = recommendedAlt + 4;

        // Configure altitude slider - with 0.2 step precision
        const slider = document.getElementById('altitudeSlider');
        slider.min = Math.floor(minElevation * 5) / 5; // Round to nearest 0.2
        slider.max = Math.ceil((safeAlt + 10) * 5) / 5; // Round to nearest 0.2
        slider.value = Math.ceil(recommendedAlt * 5) / 5; // Round to nearest 0.2
        slider.step = 0.2; // Ensure step is set
        document.getElementById('altitudeValue').innerText = (Math.ceil(recommendedAlt * 5) / 5).toFixed(1) + ' m';

        // Update zone indicators
        const range = slider.max - slider.min;
        const recommendedPercent = ((recommendedAlt - slider.min) / range) * 100;
        const safePercent = ((safeAlt - slider.min) / range) * 100;

        document.getElementById('zoneMin').style.width = recommendedPercent + '%';
        document.getElementById('zoneRecommended').style.left = recommendedPercent + '%';
        document.getElementById('zoneRecommended').style.width = (safePercent - recommendedPercent) + '%';
        document.getElementById('zoneSafe').style.left = safePercent + '%';
        document.getElementById('zoneSafe').style.width = (100 - safePercent) + '%';

        // Display terrain profile chart
        displayTerrainChart(points, elevations, recommendedAlt, safeAlt);

    } catch (error) {
        console.error('Error fetching terrain data:', error);
        alert('Failed to fetch terrain data. Please try again.');
        document.getElementById('terrainModal').style.display = 'none';
    }
}

// Generate sample points around the clicked location for terrain profile
function generateTerrainSamplePoints(latlng, count, radiusKm) {
    const points = [];
    // Center point
    points.push({latitude: latlng.lat, longitude: latlng.lng});

    // Generate a line of points in a west-east direction (for profile visualization)
    for (let i = 1; i <= count; i++) {
        // West points
        const westLng = latlng.lng - (i * (radiusKm / count) / 111.32 / Math.cos(latlng.lat * (Math.PI / 180)));
        points.push({latitude: latlng.lat, longitude: westLng});

        // East points
        const eastLng = latlng.lng + (i * (radiusKm / count) / 111.32 / Math.cos(latlng.lat * (Math.PI / 180)));
        points.push({latitude: latlng.lat, longitude: eastLng});
    }

    return points;
}

// Display terrain chart with Chart.js
function displayTerrainChart(points, elevations, recommendedAlt, safeAlt) {
    const ctx = document.getElementById('terrainChart');
    ctx.innerHTML = '';

    const canvas = document.createElement('canvas');
    ctx.appendChild(canvas);

    if (terrainChart) {
        terrainChart.destroy();
    }

    // Sort points from west to east for proper display
    const sortedData = points.map((point, index) => ({
        point: point,
        elevation: elevations[index]
    })).sort((a, b) => a.point.longitude - b.point.longitude);

    const labels = sortedData.map((item, index) => index);
    const data = sortedData.map(item => item.elevation);

    terrainChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Terrain Height',
                    data: data,
                    borderColor: 'rgba(255, 255, 255, 0.8)',
                    backgroundColor: 'rgba(0, 255, 255, 0.2)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2
                },
                {
                    label: 'Recommended Altitude',
                    data: new Array(labels.length).fill(recommendedAlt),
                    borderColor: 'rgba(255, 165, 0, 0.8)',
                    borderDash: [5, 5],
                    borderWidth: 2,
                    fill: false
                },
                {
                    label: 'Safe Altitude',
                    data: new Array(labels.length).fill(safeAlt),
                    borderColor: 'rgba(0, 255, 0, 0.8)',
                    borderDash: [5, 5],
                    borderWidth: 2,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    title: {
                        display: true,
                        text: 'Elevation (m)',
                        color: 'white',
                        font: {
                            size: 14
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'white',
                        precision: 0.2
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Distance (W → E)',
                        color: 'white',
                        font: {
                            size: 14
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'white'
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: 'white',
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    titleColor: '#00ffff',
                    bodyColor: 'white',
                    borderColor: 'rgba(0, 255, 255, 0.3)',
                    borderWidth: 1,
                    displayColors: true,
                    callbacks: {
                        label: function (context) {
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + ' m';
                        }
                    }
                }
            }
        }
    });
}

// Load all saved routes from the server
async function loadSavedRoutes() {
    try {
        const response = await fetch('/api/routes', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const routes = await response.json();
            const routeList = document.getElementById('routeList');
            routeList.innerHTML = '';

            if (routes.length === 0) {
                routeList.innerHTML = '<li>No saved routes</li>';
                return;
            }

            routes.forEach(route => {
                const li = document.createElement('li');
                li.className = 'route-item';
                li.dataset.id = route.id;
                li.innerHTML = `
                    <div>${route.name}</div>
                    <div>${route.waypoints.length} waypoints</div>
                `;

                li.addEventListener('click', () => {
                    // Deselect previous
                    document.querySelectorAll('.route-item').forEach(item => {
                        item.classList.remove('active');
                    });

                    // Select this route
                    li.classList.add('active');
                    loadRoute(route.id);
                });

                routeList.appendChild(li);
            });
        } else {
            console.error('Failed to load routes');
        }
    } catch (error) {
        console.error('Error loading routes:', error);
    }
}

// Load a specific route by ID
async function loadRoute(routeId) {
    try {
        const response = await fetch(`/api/routes/${routeId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const route = await response.json();
            clearCurrentRoute();

            // Set as current route
            currentRoute = route;
            selectedRouteId = route.id;

            // Add waypoints to map
            route.waypoints.forEach(wp => {
                const latlng = {lat: wp.lat, lng: wp.lng, alt: wp.alt};
                addWaypointToMap(latlng, wp.id);
            });

            // Optimize route
            optimizeRoute();

            // Show mission start button
            document.getElementById('startMissionBtn').style.display = 'flex';

            // Show current route details
            document.getElementById('currentRouteInfo').style.display = 'block';
            document.getElementById('currentRouteDetails').innerHTML = `
                <p>Route name: ${route.name}</p>
                <p>Waypoints: ${route.waypoints.length}</p>
            `;
            document.getElementById('saveRouteContainer').style.display = 'none';
        } else {
            console.error('Failed to load route');
        }
    } catch (error) {
        console.error('Error loading route:', error);
    }
}

// Add a new waypoint from map click
function addWaypoint(latlng) {
    // If a saved route is selected, deselect it
    if (selectedRouteId) {
        document.querySelectorAll('.route-item').forEach(item => {
            item.classList.remove('active');
        });
        selectedRouteId = null;
    }

    // Generate waypoint ID
    const waypointId = currentRoute.waypoints.length;

    // Add waypoint to the current route
    currentRoute.waypoints.push({
        id: waypointId,
        lat: latlng.lat,
        lng: latlng.lng,
        alt: latlng.alt
    });

    // Add the marker to the map
    addWaypointToMap(latlng, waypointId);

    // Optimize route if more than 2 waypoints
    if (currentRoute.waypoints.length > 2) {
        optimizeRoute();
    } else {
        // Just update polyline for simple routes
        updateRoutePolyline();
    }

    // Show save container and start mission button
    document.getElementById('currentRouteInfo').style.display = 'block';
    document.getElementById('saveRouteContainer').style.display = 'block';
    document.getElementById('startMissionBtn').style.display = 'flex';
}

// Add a waypoint marker to the map
function addWaypointToMap(latlng, id) {
    // Create custom icon with waypoint number
    const icon = L.divIcon({
        className: 'waypoint-icon',
        html: `${id + 1}`,
        iconSize: [30, 30]
    });

    // Create marker
    const marker = L.marker([latlng.lat, latlng.lng], {icon: icon}).addTo(map);

    // Add right-click event to remove waypoint
    marker.on('contextmenu', function () {
        removeWaypoint(id);
    });

    // Store marker
    waypointMarkers.push({id, marker});
}

// Remove a waypoint by ID
function removeWaypoint(id) {
    // Remove waypoint from currentRoute
    currentRoute.waypoints = currentRoute.waypoints.filter(wp => wp.id !== id);

    // Remove marker from map
    waypointMarkers.forEach(wpm => {
        if (wpm.id === id) {
            map.removeLayer(wpm.marker);
        }
    });

    // Remove from markers array
    waypointMarkers = waypointMarkers.filter(wpm => wpm.id !== id);

    // Renumber waypoints
    currentRoute.waypoints.forEach((wp, index) => {
        wp.id = index;
    });

    // Replace all markers with updated numbering
    refreshWaypointMarkers();

    // Optimize route if enough waypoints remain
    if (currentRoute.waypoints.length > 2) {
        optimizeRoute();
    } else {
        updateRoutePolyline();
    }

    // Hide mission start button if no waypoints
    if (currentRoute.waypoints.length === 0) {
        document.getElementById('startMissionBtn').style.display = 'none';
        document.getElementById('currentRouteInfo').style.display = 'none';
    }
}

// Refresh all waypoint markers (for renumbering)
function refreshWaypointMarkers() {
    // Remove all existing markers
    waypointMarkers.forEach(wpm => {
        map.removeLayer(wpm.marker);
    });

    waypointMarkers = [];

    // Add all waypoints back with correct numbering
    currentRoute.waypoints.forEach(wp => {
        const latlng = {lat: wp.lat, lng: wp.lng, alt: wp.alt};
        addWaypointToMap(latlng, wp.id);
    });
}

// Optimize route to avoid crossings (using nearest neighbor approach)
function optimizeRoute() {
    if (currentRoute.waypoints.length <= 2) return;

    const optimizedWaypoints = [];
    const remainingIndices = currentRoute.waypoints.map((_, i) => i);

    // Start with the first waypoint
    let currentIdx = 0;
    optimizedWaypoints.push({...currentRoute.waypoints[currentIdx]});
    remainingIndices.splice(remainingIndices.indexOf(currentIdx), 1);

    // Find the nearest neighbor for each subsequent waypoint
    while (remainingIndices.length > 0) {
        const currentPoint = optimizedWaypoints[optimizedWaypoints.length - 1];

        // Find nearest point
        let minDist = Infinity;
        let nearestIdx = -1;

        for (const idx of remainingIndices) {
            const wp = currentRoute.waypoints[idx];
            const dist = calculateDistance([currentPoint.lat, currentPoint.lng], [wp.lat, wp.lng]);

            if (dist < minDist) {
                minDist = dist;
                nearestIdx = idx;
            }
        }

        // Add nearest point to optimized route
        optimizedWaypoints.push({...currentRoute.waypoints[nearestIdx]});
        remainingIndices.splice(remainingIndices.indexOf(nearestIdx), 1);
    }

    // Update waypoint IDs
    optimizedWaypoints.forEach((wp, i) => {
        wp.id = i;
    });

    // Save optimized route
    currentRoute.waypoints = optimizedWaypoints;

    // Refresh markers and polyline
    refreshWaypointMarkers();
    updateRoutePolyline();
}

// Update the polyline connecting waypoints
function updateRoutePolyline() {
    // Remove existing polyline
    if (routePolyline) {
        map.removeLayer(routePolyline);
    }

    // Create coordinates array for polyline
    const coordinates = currentRoute.waypoints.map(wp => [wp.lat, wp.lng]);

    // Add closing segment back to first waypoint if we have points
    if (coordinates.length > 0) {
        coordinates.push(coordinates[0]);
    }

    // Create new polyline
    if (coordinates.length > 1) {
        routePolyline = L.polyline(coordinates, {
            color: '#00ffff',
            weight: 3,
            opacity: 0.7,
            dashArray: '5, 10'
        }).addTo(map);
    }
}

// Save the current route to the server
async function saveCurrentRoute(e) {
    e.preventDefault();

    const routeName = document.getElementById('routeName').value.trim();
    if (!routeName) {
        alert('Please enter a name for the route');
        return;
    }

    if (currentRoute.waypoints.length === 0) {
        alert('Cannot save an empty route');
        return;
    }

    const routeData = {
        id: selectedRouteId || '',
        name: routeName,
        waypoints: currentRoute.waypoints
    };

    try {
        const method = selectedRouteId ? 'PUT' : 'POST';
        const url = selectedRouteId ? `/api/routes/${selectedRouteId}` : '/api/routes';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(routeData)
        });

        if (response.ok) {
            const savedRoute = await response.json();
            selectedRouteId = savedRoute.id;

            // Update the route display
            document.getElementById('currentRouteDetails').innerHTML = `
                <p>Route name: ${savedRoute.name}</p>
                <p>Waypoints: ${savedRoute.waypoints.length}</p>
            `;

            // Reload saved routes
            loadSavedRoutes();

            // Clear route name input
            document.getElementById('routeName').value = '';

            alert('Route saved successfully');
        } else {
            console.error('Failed to save route');
            alert('Failed to save route');
        }
    } catch (error) {
        console.error('Error saving route:', error);
        alert('Error saving route');
    }
}

// Clear the current route
function clearCurrentRoute() {
    if (isDroneInMotion) {
        missionCancelled = true;
        isDroneInMotion = false;

        if (droneMarker) {
            map.removeLayer(droneMarker);
            droneMarker = null;
        }
    }

    // Clear waypoints
    currentRoute = {waypoints: []};
    selectedRouteId = null;

    // Remove existing markers
    waypointMarkers.forEach(wpm => {
        map.removeLayer(wpm.marker);
    });
    waypointMarkers = [];

    // Remove polyline
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }

    // Hide mission start button and current route info
    document.getElementById('startMissionBtn').style.display = 'none';
    document.getElementById('currentRouteInfo').style.display = 'none';
}

// Start the drone mission
async function startMission() {
    // Prevent starting if already in motion
    if (isDroneInMotion) {
        return;
    }
    missionCancelled = false;

    if (currentRoute.waypoints.length === 0) {
        alert('No waypoints defined for mission');
        return;
    }

    // If this is a saved route, tell the server to start the mission
    if (selectedRouteId) {
        try {
            const response = await fetch(`/api/routes/${selectedRouteId}/start`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                alert('Failed to start mission on the server');
                return;
            }
        } catch (error) {
            console.error('Error starting mission:', error);
            alert('Error starting mission');
            return;
        }
    } else {
        // For unsaved routes, create a temporary route
        try {
            const tempRouteName = "Temporary_" + new Date().toISOString();
            const routeData = {
                id: '',
                name: tempRouteName,
                waypoints: currentRoute.waypoints
            };

            // Save temporary route to server
            const response = await fetch('/api/routes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(routeData)
            });

            if (response.ok) {
                const savedRoute = await response.json();

                // Start mission with the temporary route
                const missionResponse = await fetch(`/api/routes/${savedRoute.id}/start`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!missionResponse.ok) {
                    alert('Failed to start mission on the server');
                    return;
                }
            } else {
                alert('Failed to create temporary route for mission');
                return;
            }
        } catch (error) {
            console.error('Error with temporary route:', error);
            alert('Error preparing mission');
            return;
        }
    }

    // Simulate drone movement on the map
    simulateDroneMission();
}

// Simulate drone movement along the route
function simulateDroneMission() {
    isDroneInMotion = true;
    document.getElementById('startMissionBtn').style.display = 'none';

    // Set initial battery level to 100%
    let batteryLevel = 100;
    document.getElementById('battery-level').textContent = `${batteryLevel}%`;

    // Create drone icon
    const droneIcon = L.divIcon({
        className: 'drone-icon',
        html: '<i class="fas fa-drone-alt"></i>',
        iconSize: [30, 30]
    });

    // Create drone marker at first waypoint
    const firstWaypoint = currentRoute.waypoints[0];
    droneMarker = L.marker([firstWaypoint.lat, firstWaypoint.lng], {
        icon: droneIcon,
        zIndexOffset: 1000 // Place above waypoint markers
    }).addTo(map);

    // Create array of waypoints (plus return to start)
    const waypoints = [...currentRoute.waypoints];
    if (waypoints.length > 0) {
        waypoints.push(waypoints[0]); // Return to start
    }

    let currentWaypointIndex = 0;
    let totalDistanceTraveled = 0;

    function moveToNextWaypoint() {
        if (currentWaypointIndex >= waypoints.length - 1) {
            // Mission complete
            setTimeout(() => {
                map.removeLayer(droneMarker);
                droneMarker = null;
                isDroneInMotion = false;
                document.getElementById('startMissionBtn').style.display = 'flex';
                // Reset battery to full
                document.getElementById('battery-level').textContent = '100%';
                document.getElementById('speed').textContent = '0 m/s';
            }, 2000);
            return;
        }

        const currentWP = waypoints[currentWaypointIndex];
        const nextWP = waypoints[currentWaypointIndex + 1];

        // Calculate distance for this segment
        const distance = calculateDistance(
            [currentWP.lat, currentWP.lng],
            [nextWP.lat, nextWP.lng]
        );

        totalDistanceTraveled += distance;

        // Determine if drone encounters an obstacle (10% chance)
        const hasObstacle = Math.random() < 0.1;

        // Determine segment speed (normal: ~9 m/s, obstacle: ~6 m/s)
        let baseSpeed = hasObstacle ? 6 : 9;
        // Add small random variation (±0.5 m/s)
        const speed = baseSpeed + (Math.random() - 0.5);

        // Calculate duration based on speed
        const duration = (distance / speed) * 1000; // in milliseconds

        // Animate drone movement
        animateDroneMovement(
            [currentWP.lat, currentWP.lng],
            [nextWP.lat, nextWP.lng],
            duration,
            speed,
            () => {
                // Update battery level based on distance traveled
                // Assuming battery depletes by ~5% for every 1000m
                batteryLevel = Math.max(0, 100 - (totalDistanceTraveled / 400));
                document.getElementById('battery-level').textContent = `${Math.round(batteryLevel)}%`;

                // Wait at waypoint for 2 seconds
                setTimeout(() => {
                    currentWaypointIndex++;
                    moveToNextWaypoint();
                }, 2000);
            }
        );
    }

    // Start movement
    moveToNextWaypoint();
}

// Animate drone movement between two points
function animateDroneMovement(startLatLng, endLatLng, duration, speed, callback) {
    const startTime = Date.now();
    const startLat = startLatLng[0];
    const startLng = startLatLng[1];
    const latDiff = endLatLng[0] - startLat;
    const lngDiff = endLatLng[1] - startLng;

    function animate() {
        if (missionCancelled) {
            return;
        }

        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const currentLat = startLat + (latDiff * progress);
        const currentLng = startLng + (lngDiff * progress);

        // Update drone position
        droneMarker.setLatLng([currentLat, currentLng]);

        // Update speed display with small variations
        if (progress < 1) {
            const currentSpeed = speed + (Math.random() - 0.5) * 0.2; // Small random variation
            document.getElementById('speed').textContent = `${currentSpeed.toPrecision(2)} m/s`;
        } else {
            document.getElementById('speed').textContent = '0 m/s';
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else if (callback) {
            callback();
        }
    }

    animate();
}

// Calculate distance between two points in meters
function calculateDistance(latlng1, latlng2) {
    const lat1 = latlng1[0];
    const lon1 = latlng1[1];
    const lat2 = latlng2[0];
    const lon2 = latlng2[1];

    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

// Change password function
async function changePassword(e) {
    e.preventDefault();

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;

    try {
        const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword
            })
        });

        if (response.ok) {
            // Close modal and reset form
            document.getElementById('changePasswordModal').classList.remove('show');
            document.getElementById('changePasswordForm').reset();
            alert('Password updated successfully');
        } else {
            const error = await response.json();
            alert(error.detail || 'Failed to update password');
        }
    } catch (error) {
        console.error('Error updating password:', error);
        alert('Error updating password');
    }
}

// Logout function
function logout() {
    localStorage.removeItem('auth_token');
    window.location.reload();
}

// Parse JWT token
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}