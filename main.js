import './style.css';
import {Map, View} from 'ol';
import TileLayer from 'ol/layer/WebGLTile.js';
import OSM from 'ol/source/OSM';
import {fromLonLat,transformExtent} from 'ol/proj';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import LayerGroup from 'ol/layer/Group.js';
import colormap from 'colormap';
import { fromUrl } from 'geotiff';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import {fromExtent} from 'ol/geom/Polygon.js';
import {Stroke, Style} from 'ol/style.js';

// STAC item URL
const urlItem = "results.json";

// Controls
const varSelect = document.getElementById('varSelect');
const prevBtn   = document.getElementById('prevBtn');
const nextBtn   = document.getElementById('nextBtn');

class LayerList extends LayerGroup {
    #length;
    constructor(options) {
        const { variable, urls, ...layerGroupOptions } = options || {};
        super(layerGroupOptions);
        this.variable = variable || null;
        this.urls = urls || null;
        this.#length = this.getLayers().getLength();
        this.currentRaster = 0;
        this.showCurrent();
        prevBtn.onclick = () => this.showPrevious();
        nextBtn.onclick = () => this.showNext();
    }

    get length() {
        return this.#length;
    }

    showCurrent() {
        const index = this.currentRaster;
        this.getLayers().forEach((layer,i) => {
            layer.setVisible(i === index);
        });
        const url = this.urls[index];
        getAssetMetaData(url,index,this.length).then(showAssetInfo);
    }

    showNext() {
        this.currentRaster = (this.currentRaster + 1) % this.length;
        this.showCurrent();
    }

    showPrevious() {
        this.currentRaster = (this.currentRaster - 1 + this.length) % this.length;
        this.showCurrent();
    }
}

function initMap() {
    const map = new Map({
      target: 'map-container',
      layers: [
        new TileLayer({
          source: new OSM()
        })
      ],
      view: new View({
        center: fromLonLat([15,36.5]),
        zoom: 6
      })
    });
    
    // Retrieve STAC item metadata from JSON
    const stacItem = getItemFromJSON(urlItem);

    // Create vector layer for bbox
    stacItem.then(item => createVectorLayer(item,map))
            .then(l => map.addLayer(l));

    // Get grouped assets for every variable and
    // generate rasters for selected variable
    const groupedAssets = stacItem.then(getAssetsFromItem)
    groupedAssets.then(createVariableSelector);
    let layerGroup = groupedAssets.then(createRasterLayer);
    layerGroup.then(l => map.addLayer(l));

    // add event for variable selector
    varSelect.addEventListener('change', event => {
        layerGroup.then(l => map.removeLayer(l));
        layerGroup = groupedAssets.then(createRasterLayer);
        layerGroup.then(l => map.addLayer(l));
    });
}

async function getItemFromJSON(url) {
    try {
        // Fetch item STAC information
        const response = await fetch(url);
        const item = await response.json();
        return item;
    } catch (error) {
        console.error('Error fetching STAC item:', error);
        throw error;
    }
}

function createVectorLayer(item,map) {
    const view = map.getView();
    const extent = transformExtent( 
        item.bbox, 
        'EPSG:4326',
        view.getProjection() 
    );
    const boxLayer = new VectorLayer({
        source: new VectorSource({
            features: [
                new Feature( fromExtent(extent) ),
            ],
        }),
        style: new Style({
            stroke: new Stroke({
                color: [250,152,12,0.4],
                width: 3,
            })
        }),
    });
    return boxLayer;
}

function getAssetsFromItem(item) {
    const assets = item.assets;
    const groupedAssets = {};

    for (const key in assets){
        const variable = assets[key].key
        if (variable !== undefined) {
            if (!groupedAssets[variable]) {
                groupedAssets[variable] = [];
            }
            groupedAssets[variable].push(assets[key]);
        }
    }
    return groupedAssets;
}

function createVariableSelector(groupedAssets) {
    const options = Object.keys(groupedAssets);
    // Add new options
    options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        varSelect.appendChild(opt);
    });
}

function createRasterLayer(groupedAssets) {
    const variable = varSelect.value;
    const style = createColorbar(variable);
    const assetList = groupedAssets[variable];
    const layers = assetList.map(asset => {
        const source = new GeoTIFF({
            normalize: false,
            interpolate: true,
            transition: 0,
            sources: [ { url: asset.href, bands: [1] } ],
        });
        return new TileLayer({
            source: source, 
            visible: false,
            style: style
        });
    });
    const urls = assetList.map(asset => asset.href);
    return new LayerList({layers: layers, urls: urls});
}

async function getAssetMetaData(url,currentStep,totalSteps) {
    let tiff = await fromUrl(url);
    const image = await tiff.getImage(0);
    const metadataFields = await image.getGDALMetadata();
    const forecastHours = metadataFields.step.padStart(3, '0');
    const assetMetaData = {
        title: `${metadataFields.label} +${forecastHours}h FCST`,
        valid: `Valid: ${metadataFields.time}`,
        created: `Created: ${metadataFields.created}`,
        step: `Step: ${currentStep+1} / ${totalSteps}`,
    }
    return assetMetaData;
}

function showAssetInfo(assetMetaData) {
    document.getElementById('current-raster-name').textContent = assetMetaData.title;
    document.getElementById('current-raster-description').textContent = assetMetaData.valid;
    document.getElementById('current-raster-created').textContent = assetMetaData.created;
    document.getElementById('current-raster-index').textContent = assetMetaData.step;
}

// Create colorbar
function createColorbar(variable) {
    let levels;
    let cmap;
    let label;

    switch(variable){
        case "tephra_col_mass":
            levels = [0.1,2,3,4,5,6,7,8];
            cmap   = 'RdBu';
            label  = "Tephra column mass [g/m<sup>2</sup>]";
            break;
        case "SO2_col_mass":
            levels = [1, 5, 10, 15, 20, 25, 30, 35, 40];
            cmap   = 'RdBu';
            label  = "SO2 column mass [DU]";
            break;
        case "tephra_cloud_top":
            levels = [5000,5500,6000,6500,7000,7500,8000,8500,9000];
            cmap   = 'viridis';
            label  = "Tephra cloud top height [m]";
            break;
        default:
            levels = [1,2,3,4,5,6,7,8,9,10];
            cmap   = 'viridis';
            label  = "Undefined";
    }

    const minVal = Math.min(...levels); 
    const stops = getColorStops(cmap,levels);
    const data = ['band', 1];
    const style = {
        color: [
            'case',
            ['<',data,minVal],
            [0,0,0,0],
            ['interpolate',
            ['linear'],
            data,
            ...stops,
            ]
          ],
        };
    drawColorBar(stops,label);
    return style;
}

function drawColorBar(stops,label) {
    const labelsContainer = document.getElementById('colorbar-labels');
    const titleContainer  = document.getElementById('colorbar-title');
    const colorbarCanvas  = document.getElementById('colorbar');
    const colorbarCtx = colorbarCanvas.getContext('2d');
    
    const steps = stops.length/2;
    const barHeight = 200;
    const barWidth  = 20;
    const segmentHeight = barHeight / steps;

    // Clear previous labels
    labelsContainer.innerHTML = '';

    for (let i = 0; i < steps; i++) {
      const y = barHeight - (i+1)*segmentHeight;
      const value = stops[i * 2];
      const color = stops[i * 2 + 1];

      // Draw color rectangle
      colorbarCtx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`;
      colorbarCtx.fillRect(0, y, barWidth, segmentHeight);

      // Create label
      const label = document.createElement('span');
      label.textContent = value;
      label.style.position = 'absolute';
      label.style.top = `${y + segmentHeight/2}px`;
      label.style.transform = 'translateY(-50%)';
      labelsContainer.appendChild(label);
    }

    // Update labels container style
    labelsContainer.style.width = 'auto';
    const contentWidth = labelsContainer.scrollWidth;
    labelsContainer.style.width = contentWidth + 'px';

    titleContainer.innerHTML = label;
}

function getColorStops(cmap, levels) {
  const steps = levels.length;
  const stops = new Array(steps * 2);
  const colors = colormap({
      colormap: cmap, 
      nshades: steps, 
      format: 'rgba',
      alpha: 0.6
  });
  for (let i = 0; i < steps; i++) {
    stops[i * 2] = levels[i];
    stops[i * 2 + 1] = colors[i];
  }
  return stops;
}

// Initialize the application
window.addEventListener("load", initMap);
