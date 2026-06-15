 










let params = {
    
    
    
    
    
    
    

    seed: 12345,
    
    
};






function initializeSeed(seed) {
    randomSeed(seed);
    noiseSeed(seed);
    
}





function setup() {
    createCanvas(800, 800);

    
    initializeSeed(params.seed);

    
    
    
    
    
    

    
    
}

function draw() {
    
    
    
    

    
    
    
    

    
    
    
}







class Entity {
    constructor() {
        
        
    }

    update() {
        
        
        
        
        
    }

    display() {
        
        
    }
}





















function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function colorFromPalette(index) {
    return params.colorPalette[index % params.colorPalette.length];
}


function mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}


function wrapAround(value, max) {
    if (value < 0) return max;
    if (value > max) return 0;
    return value;
}





function updateParameter(paramName, value) {
    params[paramName] = value;
    
    
}

function regenerate() {
    
    
    initializeSeed(params.seed);
    
}






function fadeBackground(opacity) {
    fill(250, 249, 245, opacity); 
    noStroke();
    rect(0, 0, width, height);
}


function getNoiseValue(x, y, scale = 0.01) {
    return noise(x * scale, y * scale);
}


function vectorFromAngle(angle, magnitude = 1) {
    return createVector(cos(angle), sin(angle)).mult(magnitude);
}





function exportImage() {
    saveCanvas('generative-art-' + params.seed, 'png');
}

















