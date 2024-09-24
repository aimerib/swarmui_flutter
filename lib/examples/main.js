let gen_param_types = null, rawGenParamTypesFromServer = null;

let lastImageDir = '';

let lastModelDir = '';

let num_current_gens = 0, num_models_loading = 0, num_live_gens = 0, num_backends_waiting = 0;

let shouldApplyDefault = false;

let sessionReadyCallbacks = [];

let allModels = [];

let coreModelMap = {};

let otherInfoSpanContent = [];

let isGeneratingForever = false, isGeneratingPreviews = false;

let lastHistoryImage = null, lastHistoryImageDiv = null;

let currentMetadataVal = null, currentImgSrc = null;

let autoCompletionsList = null;
let autoCompletionsOptimize = false;

let mainGenHandler = new GenerateHandler();

function updateOtherInfoSpan() {
    let span = getRequiredElementById('other_info_span');
    span.innerHTML = otherInfoSpanContent.join(' ');
}

const time_started = Date.now();

let statusBarElem = getRequiredElementById('top_status_bar');

/** Called when the user clicks the clear batch button. */
function clearBatch() {
    let currentImageBatchDiv = getRequiredElementById('current_image_batch');
    currentImageBatchDiv.innerHTML = '';
    currentImageBatchDiv.dataset.numImages = 0;
}

/** Reference to the auto-clear-batch toggle checkbox. */
let autoClearBatchElem = getRequiredElementById('auto_clear_batch_checkbox');
autoClearBatchElem.checked = localStorage.getItem('autoClearBatch') != 'false';
/** Called when the user changes auto-clear-batch toggle to update local storage. */
function toggleAutoClearBatch() {
    localStorage.setItem('autoClearBatch', `${autoClearBatchElem.checked}`);
}

/** Reference to the auto-load-previews toggle checkbox. */
let autoLoadPreviewsElem = getRequiredElementById('auto_load_previews_checkbox');
autoLoadPreviewsElem.checked = localStorage.getItem('autoLoadPreviews') == 'true';
/** Called when the user changes auto-load-previews toggle to update local storage. */
function toggleAutoLoadPreviews() {
    localStorage.setItem('autoLoadPreviews', `${autoLoadPreviewsElem.checked}`);
}

/** Reference to the auto-load-images toggle checkbox. */
let autoLoadImagesElem = getRequiredElementById('auto_load_images_checkbox');
autoLoadImagesElem.checked = localStorage.getItem('autoLoadImages') != 'false';
/** Called when the user changes auto-load-images toggle to update local storage. */
function toggleAutoLoadImages() {
    localStorage.setItem('autoLoadImages', `${autoLoadImagesElem.checked}`);
}

function clickImageInBatch(div) {
    let imgElem = div.getElementsByTagName('img')[0];
    if (currentImgSrc == div.dataset.src) {
        showFullImage(div.dataset.src, div.dataset.metadata);
        return;
    }
    setCurrentImage(div.dataset.src, div.dataset.metadata, div.dataset.batch_id ?? '', imgElem.dataset.previewGrow == 'true');
}

/** "Reuse Parameters" button impl. */
function copy_current_image_params() {
    if (!currentMetadataVal) {
        alert('No parameters to copy!');
        return;
    }
    let metadata = JSON.parse(currentMetadataVal).sui_image_params;
    if ('original_prompt' in metadata) {
        metadata.prompt = metadata.original_prompt;
    }
    if ('original_negativeprompt' in metadata) {
        metadata.negativeprompt = metadata.original_negativeprompt;
    }
    // Special hacks to repair edge cases in LoRA reuse
    // There should probably just be a direct "for lora in list, set lora X with weight Y" instead of this
    if ('lorasectionconfinement' in metadata && 'loras' in metadata && 'loraweights' in metadata) {
        let confinements = metadata.lorasectionconfinement;
        let loras = metadata.loras;
        let weights = metadata.loraweights;
        if (confinements.length == loras.length && loras.length == weights.length) {
            let newLoras = [];
            let newWeights = [];
            for (let i = 0; i < confinements.length; i++) {
                if (confinements[i] == -1) {
                    newLoras.push(loras[i]);
                    newWeights.push(weights[i]);
                }
            }
            metadata.loras = newLoras;
            metadata.loraweights = newWeights;
            delete metadata.lorasectionconfinement;
        }
    }
    if ('loras' in metadata && 'loraweights' in metadata && document.getElementById('input_loras') && metadata.loras.length == metadata.loraweights.length) {
        let loraElem = getRequiredElementById('input_loras');
        for (let val of metadata.loras) {
            if (val && !$(loraElem).find(`option[value="${val}"]`).length) {
                $(loraElem).append(new Option(val, val, false, false));
            }
        }
        let valSet = [...loraElem.options].map(option => option.value);
        let newLoras = [];
        let newWeights = [];
        for (let val of valSet) {
            let index = metadata.loras.indexOf(val);
            if (index != -1) {
                newLoras.push(metadata.loras[index]);
                newWeights.push(metadata.loraweights[index]);
            }
        }
        metadata.loras = newLoras;
        metadata.loraweights = newWeights;
    }
    let exclude = getUserSetting('reuseparamexcludelist').split(',').map(s => cleanParamName(s));
    resetParamsToDefault(exclude);
    for (let param of gen_param_types) {
        if (param.nonreusable || exclude.includes(param.id)) {
            continue;
        }
        let elem = document.getElementById(`input_${param.id}`);
        let val = metadata[param.id];
        if (elem && val !== undefined && val !== null && val !== '') {
            setDirectParamValue(param, val);
            if (param.toggleable && param.visible) {
                let toggle = getRequiredElementById(`input_${param.id}_toggle`);
                toggle.checked = true;
                doToggleEnable(elem.id);
            }
            if (param.group && param.group.toggles) {
                let toggle = getRequiredElementById(`input_group_content_${param.group.id}_toggle`);
                if (!toggle.checked) {
                    toggle.click();
                }
            }
        }
        else if (elem && param.toggleable && param.visible) {
            let toggle = getRequiredElementById(`input_${param.id}_toggle`);
            toggle.checked = false;
            doToggleEnable(elem.id);
        }
    }
    hideUnsupportableParams();
}

let metadataKeyFormatCleaners = [];

function formatMetadata(metadata) {
    if (!metadata) {
        return '';
    }
    let data;
    try {
        let readable = interpretMetadata(metadata);
        if (!readable) {
            return '';
        }
        data = JSON.parse(readable).sui_image_params;
    }
    catch (e) {
        console.log(`Error parsing metadata '${metadata}': ${e}`);
        return `Broken metadata: ${escapeHtml(metadata)}`;
    }
    let result = '';
    function appendObject(obj) {
        if (obj) {
            for (let key of Object.keys(obj)) {
                let val = obj[key];
                if (val !== null && val !== '') { // According to javascript, 0 == '', so have to === to block that. Argh.
                    for (let cleaner of metadataKeyFormatCleaners) {
                        key = cleaner(key);
                    }
                    let hash = Math.abs(hashCode(key.toLowerCase().replaceAll(' ', '').replaceAll('_', ''))) % 10;
                    let added = '';
                    if (key.includes('model') || key.includes('lora') || key.includes('embedding')) {
                        added += ' param_view_block_model';
                    }
                    if (typeof val == 'object') {
                        result += `<span class="param_view_block tag-text tag-type-${hash}${added}"><span class="param_view_name">${escapeHtml(key)}</span>: `;
                        appendObject(val);
                        result += `</span>, `;
                    }
                    else {
                        result += `<span class="param_view_block tag-text tag-type-${hash}${added}"><span class="param_view_name">${escapeHtml(key)}</span>: <span class="param_view tag-text-soft tag-type-${hash}">${escapeHtml(`${val}`)}</span></span>, `;
                    }
                }
            }
        }
    };
    appendObject(data);
    return result;
}

/** Mobile-specific helper class for handling image full view modal */
class MobileImageFullViewHelper {
    constructor() {
        // Create mobile-specific modal elements
        this.createMobileModal();

        // Bind touch event handlers
        this.bindEvents();

        // Initialize transformation states
        this.currentScale = 1;
        this.initialDistance = 0;
        this.translateX = 0;
        this.translateY = 0;
        this.startX = 0;
        this.startY = 0;
        this.isDragging = false;
        this.isPinching = false;
        this.lastTouchX = 0;
        this.lastTouchY = 0;


        // Initialize variables for double-tap detection
        this.lastTap = 0;
        this.tapTimeout = 300; // Maximum time between taps for double-tap
        this.tapDistance = 50; // Maximum distance (in pixels) between taps for double-tap

        // Bind the double-tap event
        this.pixelRatio = window.devicePixelRatio || 1;
    }

    /** Binds double-tap event listener */
    bindDoubleTap() {
        this.modal.addEventListener('touchend', this.onDoubleTap.bind(this));
    }

    /** Handles double-tap gesture to reset scale and re-center image */
    onDoubleTap(e) {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - this.lastTap;
        const touch = e.changedTouches[0];
        const tapX = touch.clientX;
        const tapY = touch.clientY;
        if (tapLength < this.tapTimeout && tapLength > 0) {
            // Check distance between taps
            const deltaX = tapX - this.lastTapX;
            const deltaY = tapY - this.lastTapY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance < this.tapDistance) {
                // Double-tap detected
                this.resetTransform();
            }
        }
        this.lastTap = currentTime;
        this.lastTapX = tapX;
        this.lastTapY = tapY;
    }

    resetTransform() {
        this.currentScale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.drawImage();
    }

    /** Creates the mobile modal structure dynamically */
    createMobileModal() {
        // Check if the mobile modal already exists to prevent duplicates
        if (document.getElementById('mobile_image_fullview_modal')) return;

        // Create modal container
        this.modal = document.createElement('div');
        this.modal.id = 'mobile_image_fullview_modal';
        this.modal.className = 'mobile-modal';
        this.modal.style.display = 'none';
        this.modal.style.position = 'fixed';
        this.modal.style.top = '0';
        this.modal.style.left = '0';
        this.modal.style.width = '100%';
        this.modal.style.height = '100%';
        this.modal.style.backgroundColor = 'var(--background-soft)';
        this.modal.style.zIndex = '10000';
        this.modal.style.justifyContent = 'center';
        this.modal.style.alignItems = 'center';
        this.modal.style.flexDirection = 'column';
        this.modal.style.overflow = 'hidden';

        // Create canvas container
        this.canvasContainer = document.createElement('div');
        this.canvasContainer.id = 'mobile_image_fullview_container';
        this.canvasContainer.style.position = 'relative';

        // Create canvas element
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'mobile_image_fullview_canvas';
        this.canvas.style.touchAction = 'none'; // Prevent default touch actions
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.canvas.style.maxWidth = '100%';
        this.canvas.style.maxHeight = '100%';
        this.canvas.style.borderRadius = '8px';
        this.canvas.style.backgroundColor = 'transparent';
        this.ctx = this.canvas.getContext('2d');

        // Scale the context to account for device pixel ratio
        this.ctx.scale(this.pixelRatio, this.pixelRatio);

        // Create metadata container
        this.metadataContainer = document.createElement('div');
        this.metadataContainer.id = 'mobile_image_fullview_metadata';

        // Append elements
        this.canvasContainer.appendChild(this.canvas);
        this.canvasContainer.appendChild(this.metadataContainer);
        this.modal.appendChild(this.canvasContainer);

        this.modal.appendChild(this.metadataContainer);
        document.body.appendChild(this.modal);
    }

    /** Binds touch and click event listeners for gestures and controls */
    bindEvents() {
        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
        // Bind the double-tap event
        this.canvas.addEventListener('touchend', this.onDoubleTap.bind(this));
        // Close modal when tapping outside the image (optional, based on your UI)
        this.modal.addEventListener('touchstart', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });
    }

    /** Display the image in full-screen mode with metadata */
    showImage(src, metadata) {
        createImageActionButtons(src, this.img, metadata, this.modal, true);
        // Load the image
        this.image = new Image();
        this.image.crossOrigin = 'Anonymous'; // Handle cross-origin if necessary
        this.image.onload = () => {
            this.canvas.width = this.image.naturalWidth;
            this.canvas.height = this.image.naturalHeight;
            // Reset transformations
            this.resetTransform();
            // Calculate initial scale to ensure at least two connected edges are touched
            this.calculateInitialScale();
            // Adjust translations based on initial scale
            this.constrainTranslation();
            // Initial draw
            this.drawImage();
            // Display metadata
            this.metadataContainer.innerHTML = formatMetadata(metadata);
            // Remove ", " separators from the metadata container on mobile
            this.removeCommasFromMetadata();
            // Show the modal
            this.modal.style.display = 'flex';
        };
        this.image.onerror = (e) => {
            console.error( `Failed to load image: ${src}`, e);
            const canvasWidth = this.canvas.width / this.pixelRatio;
            const canvasHeight = this.canvas.height / this.pixelRatio;
            this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            this.ctx.fillStyle = '#ff0000';
            this.ctx.font = '20px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('Failed to load image', this.canvas.width / 2, this.canvas.height / 2);
        };
        this.image.src = `${window.location.origin}/${src}`;
    }


    /** Helper method to remove ", " separators from the metadata container */
    removeCommasFromMetadata() {
        // Get all child nodes of the metadata container
        const childNodes = Array.from(this.metadataContainer.childNodes);

        childNodes.forEach((node, index) => {
            // If the node is a text node and contains ", ", remove it
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === ',') {
                this.metadataContainer.removeChild(node);
            }
        });
    }

    /** Calculate the initial scale to ensure the image touches at least two connected edges */
    calculateInitialScale() {
        const canvasWidth = this.canvas.width / this.pixelRatio;
        const canvasHeight = this.canvas.height / this.pixelRatio;
        const imageWidth = this.image.naturalWidth;
        const imageHeight = this.image.naturalHeight;

        const scaleX = canvasWidth / imageWidth;
        const scaleY = canvasHeight / imageHeight;

        // Choose the larger scale to ensure at least two connected edges
        this.currentScale = Math.max(scaleX, scaleY, 1); // Prevent scaling below 1

        // Reset translations
        this.translateX = 0;
        this.translateY = 0;
    }

    /** Close the mobile modal */
    close() {
        this.modal.style.display = 'none';
        // Clear the canvas
        const canvasWidth = this.canvas.width / this.pixelRatio;
        const canvasHeight = this.canvas.height / this.pixelRatio;
        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        this.metadataContainer.innerHTML = '';
    }

    drawImage() {
        if (!this.image) return;

        const ctx = this.canvas.getContext('2d');
        const canvasWidth = this.canvas.width / this.pixelRatio;
        const canvasHeight = this.canvas.height / this.pixelRatio;

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        ctx.save();
        ctx.translate(this.translateX, this.translateY);
        ctx.scale(this.currentScale, this.currentScale);
        ctx.drawImage(this.image, 0, 0);
        ctx.restore();
    }

    onTouchStart(e) {
        if (e.touches.length === 1) {
        // Single touch start - panning
            this.isDragging = true;

            this.lastTouchX = e.touches[0].clientX;
            this.lastTouchY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
        // Two fingers - pinch to zoom
            this.isPinching = true;
            this.initialDistance = this.getDistance(e.touches[0], e.touches[1]);
            this.initialScale = this.currentScale;
        }
    }

    onTouchMove(e) {
        e.preventDefault();
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const imageWidth = this.image.naturalWidth * this.currentScale;
        const imageHeight = this.image.naturalHeight * this.currentScale;


        if (this.isDragging && e.touches.length === 1) {
            const touch = e.touches[0];
            const deltaX = touch.clientX - this.lastTouchX;
            const deltaY = touch.clientY - this.lastTouchY;

            // Update translation
            this.translateX += deltaX * this.pixelRatio;
            this.translateY += deltaY * this.pixelRatio;

            // Constrain translation
            this.translateX = Math.min(0, Math.max(canvasWidth - imageWidth, this.translateX));
            this.translateY = Math.min(0, Math.max(canvasHeight - imageHeight, this.translateY));

            this.lastTouchX = touch.clientX;
            this.lastTouchY = touch.clientY;

        } else if (this.isPinching && e.touches.length === 2) {
            const currentDistance = this.getDistance(e.touches[0], e.touches[1]);
            const scaleFactor = currentDistance / this.initialDistance;

            const prevScale = this.currentScale;
            this.currentScale = Math.min(Math.max(this.initialScale * scaleFactor, 1), 4);

            const zoomCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const zoomCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            // Adjust translation to zoom towards the center of the pinch
            this.translateX += (zoomCenterX - this.translateX) * (1 - this.currentScale / prevScale);
            this.translateY += (zoomCenterY - this.translateY) * (1 - this.currentScale / prevScale);

        }

        this.constrainTranslation();
        this.drawImage();
    }

    onTouchEnd(e) {
        if (this.isDragging && e.touches.length === 0) {
            this.isDragging = false;
        }
        if (this.isPinching && e.touches.length < 2) {
            this.isPinching = false;
        }
    }

    /** Calculate distance between two touch points */
    getDistance(touch1, touch2) {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /** Calculate the center point between two touches */
    getTouchCenter(touch1, touch2) {
        return {
            x: (touch1.pageX + touch2.pageX) / 2,
            y: (touch1.pageY + touch2.pageY) / 2
        };
    }

    /** Adjust canvas size on window resize */
    resizeCanvas() {
        // Update canvas dimensions
        this.canvas.width = window.innerWidth * this.pixelRatio;
        this.canvas.height = window.innerHeight * this.pixelRatio;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.ctx.scale(this.pixelRatio, this.pixelRatio);

        if (this.image) {
            this.calculateInitialScale();
            this.constrainTranslation();
            this.drawImage();
        }
    }

    /** Constrains the translation to ensure at least two connected edges are touched */
    constrainTranslation() {
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const imageWidth = this.image.naturalWidth * this.currentScale;
        const imageHeight = this.image.naturalHeight * this.currentScale;

        if (imageWidth <= canvasWidth) {
            this.translateX = (canvasWidth - imageWidth) / 2;
        } else {
            this.translateX = Math.min(0, Math.max(canvasWidth - imageWidth, this.translateX));
        }

        if (imageHeight <= canvasHeight) {
            this.translateY = (canvasHeight - imageHeight) / 2;
        } else {
            this.translateY = Math.min(0, Math.max(canvasHeight - imageHeight, this.translateY));
        }
    }
}

/** Central helper class to handle the 'image full view' modal. */
class ImageFullViewHelper {
    constructor() {
        this.zoomRate = 1.1;
        this.modal = getRequiredElementById('image_fullview_modal');
        this.content = getRequiredElementById('image_fullview_modal_content');
        this.modalJq = $('#image_fullview_modal');
        this.noClose = false;
        document.addEventListener('click', (e) => {
            if (e.target.closest('#current_image button') || e.touches?.length > 0) {
                return; // Do not interfere with button clicks
            }
            if (e.target.tagName == 'BODY') {
                return; // it's impossible on the genpage to actually click body, so this indicates a bugged click, so ignore it
            }
            if (!this.noClose && this.modal.style.display == 'block' && !findParentOfClass(e.target, 'imageview_popup_modal_undertext')) {
                this.close();
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
            this.noClose = false;
        }, true);
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.isDragging = false;
        this.didDrag = false;
        this.initialScale = 1;
        this.currentScale = 1;
        this.initialDistance = 0;
        this.content.addEventListener('wheel', this.onWheel.bind(this));
        this.content.addEventListener('mousedown', this.onMouseDown.bind(this));
        document.addEventListener('mouseup', this.onGlobalMouseUp.bind(this));
        document.addEventListener('mousemove', this.onGlobalMouseMove.bind(this));
    }

    getImg() {
        return getRequiredElementById('imageview_popup_modal_img');
    }

    getCurrentImage() {
        return getRequiredElementById('current_image');
    }

    getHeightPercent() {
        return parseFloat((this.getImg().style.height || '100%').replaceAll('%', ''));
    }

    getImgLeft() {
        return parseFloat((this.getImg().style.left || '0').replaceAll('px', ''));
    }

    getImgTop() {
        return parseFloat((this.getImg().style.top || '0').replaceAll('px', ''));
    }

    onMouseDown(e) {
        if (this.modal.style.display != 'block') {
            return;
        }
        if (e.button == 2) { // right-click
            return;
        }
        this.startDrag(e.clientX, e.clientY);
        e.preventDefault();
        e.stopPropagation();
    }

    onTouchStart(e) {
        let img = this.getCurrentImage();
        if (this.modal.style.display != 'block') {
            return;
        }
        // If the touch is on a button or its child, do not interfere
        if (e.target.closest('.current-image-buttons button')) {
            return; // Allow button touch events to propagate naturally
        }

        if (e.touches.length === 2 && e.target === img) {
            this.initialDistance = this.getDistance(e.touches[0], e.touches[1]);
            this.initialScale = this.currentScale;
        } else if (e.touches.length === 1 && e.target === img) {
            this.startDrag(e.touches[0].clientX, e.touches[0].clientY);
            e.preventDefault();
            e.stopPropagation();
        }
    }

    startDrag(clientX, clientY) {
        this.lastMouseX = clientX;
        this.lastMouseY = clientY;
        this.isDragging = true;
        this.getImg().style.cursor = 'grabbing';
    }

    onGlobalMouseUp(e) {
        if (!this.isDragging) {
            return;
        }
        this.getImg().style.cursor = 'grab';
        this.isDragging = false;
        this.noClose = this.didDrag;
        this.didDrag = false;
    }

    moveImg(xDiff, yDiff) {
        let img = this.getImg();
        let newLeft = this.getImgLeft() + xDiff;
        let newTop = this.getImgTop() + yDiff;

        if (isLikelyMobile()) {
            let wrap = img.parentElement;
            let imgRect = img.getBoundingClientRect();
            let wrapRect = wrap.getBoundingClientRect();

            // Calculate how much the image overflows the wrapper
            let horizontalOverflow = Math.max(0, imgRect.width - wrapRect.width);
            let verticalOverflow = Math.max(0, imgRect.height - wrapRect.height);

            // Get current left and top positions (relative to wrapper)
            let currentLeft = this.getImgLeft();
            let currentTop = this.getImgTop();

            // Update new positions based on movement input (xDiff, yDiff)
            let newLeft = currentLeft + xDiff;
            let newTop = currentTop + yDiff;

            // Clamp horizontal movement
            if (imgRect.width > wrapRect.width) {
                if (xDiff < 0) { // Moving left
                    newLeft = Math.max(newLeft, -horizontalOverflow / 2);
                } else { // Moving right
                    newLeft = Math.min(newLeft, horizontalOverflow / 2);
                }
            } else {
                newLeft = 0; // Center if image is smaller
            }

            // Clamp vertical movement
            if (imgRect.height > wrapRect.height) {
                if (yDiff < 0) { // Moving up
                    newTop = Math.max(newTop, -verticalOverflow / 2);
                } else { // Moving down
                    newTop = Math.min(newTop, verticalOverflow / 2);
                }
            } else {
                newTop = 0; // Center if image is smaller
            }
        } else {
            let overWidth = img.parentElement.offsetWidth / 2;
            let overHeight = img.parentElement.offsetHeight / 2;
            newLeft = Math.min(overWidth, Math.max(newLeft, img.parentElement.offsetWidth - img.width - overWidth));
            newTop = Math.min(overHeight, Math.max(newTop, img.parentElement.offsetHeight - img.height - overHeight));
        }
        img.style.left = `${newLeft}px`;
        img.style.top = `${newTop}px`;
    }

    updateImagePosition() {
        let img = this.getImg();
        let wrap = img.parentElement;
        let imgRect = img.getBoundingClientRect();
        let wrapRect = wrap.getBoundingClientRect();

        let newLeft, newTop;

        // Ensure at least one horizontal edge touches
        if (imgRect.width > wrapRect.width) {
            newLeft = Math.min(0, Math.max(wrapRect.width - imgRect.width, this.getImgLeft()));
        } else {
            newLeft = (wrapRect.width - imgRect.width) / 2; // Center horizontally
        }

        // Ensure at least one vertical edge touches
        if (imgRect.height > wrapRect.height) {
            newTop = Math.min(0, Math.max(wrapRect.height - imgRect.height, this.getImgTop()));
        } else {
            newTop = (wrapRect.height - imgRect.height) / 2; // Center vertically
        }

        img.style.left = `${newLeft}px`;
        img.style.top = `${newTop}px`;
    }

    onGlobalMouseMove(e) {
        if (!this.isDragging) {
            return;
        }
        this.detachImg();
        let clientX, clientY;
        if (e.touches) {
            // Touch event
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            // Mouse event
            clientX = e.clientX;
            clientY = e.clientY;
        }
        let xDiff = clientX - this.lastMouseX;
        let yDiff = clientY - this.lastMouseY;
        this.lastMouseX = clientX;
        this.lastMouseY = clientY;
        this.moveImg(xDiff, yDiff);
        if (Math.abs(xDiff) > 1 || Math.abs(yDiff) > 1) {
            this.didDrag = true;
        }
    }

    detachImg() {
        let wrap = getRequiredElementById('imageview_modal_imagewrap');
        if (wrap.style.textAlign == 'center') {
            let img = this.getImg();
            wrap.style.textAlign = 'left';
            let imgAspectRatio = img.naturalWidth / img.naturalHeight;
            let wrapAspectRatio = wrap.offsetWidth / wrap.offsetHeight;
            let targetWidth = wrap.offsetHeight * imgAspectRatio;
            if (targetWidth > wrap.offsetWidth) {
                img.style.top = `${(wrap.offsetHeight - (wrap.offsetWidth / imgAspectRatio)) / 2}px`;
                img.style.height = `${(wrapAspectRatio / imgAspectRatio) * 100}%`;
                img.style.left = '0px';
            }
            else {
                img.style.top = '0px';
                img.style.left = `${(wrap.offsetWidth - targetWidth) / 2}px`;
                img.style.height = `100%`;
            }
            img.style.objectFit = '';
            img.style.maxWidth = '';
        }
    }

    copyState() {
        let img = this.getImg();
        if (img.style.objectFit) {
            return {};
        }
        return {
            left: this.getImgLeft(),
            top: this.getImgTop(),
            height: this.getHeightPercent()
        };
    }

    pasteState(state) {
        if (!state || !state.left) {
            return;
        }
        let img = this.getImg();
        this.detachImg();
        img.style.left = `${state.left}px`;
        img.style.top = `${state.top}px`;
        img.style.height = `${state.height}%`;
    }

    onWheel(e) {
        this.detachImg();
        let img = this.getImg();
        let origHeight = this.getHeightPercent();
        let zoom = Math.pow(this.zoomRate, -e.deltaY / 100);
        let maxHeight = Math.sqrt(img.naturalWidth * img.naturalHeight) * 2;
        let newHeight = Math.max(10, Math.min(origHeight * zoom, maxHeight));
        if (newHeight > maxHeight / 5) {
            img.style.imageRendering = 'pixelated';
        }
        else {
            img.style.imageRendering = '';
        }
        img.style.cursor = 'grab';
        let [imgLeft, imgTop] = [this.getImgLeft(), this.getImgTop()];
        let [mouseX, mouseY] = [e.clientX - img.offsetLeft, e.clientY - img.offsetTop];
        let [origX, origY] = [mouseX / origHeight - imgLeft, mouseY / origHeight - imgTop];
        let [newX, newY] = [mouseX / newHeight - imgLeft, mouseY / newHeight - imgTop];
        this.moveImg((newX - origX) * newHeight, (newY - origY) * newHeight);
        img.style.height = `${newHeight}%`;
    }

    onTouchMove(e) {
        let img = this.getCurrentImage();
        if (e.touches.length === 2 && e.target === img) {
            e.preventDefault();
            const currentDistance = this.getDistance(e.touches[0], e.touches[1]);
            const scale = currentDistance / this.initialDistance;
            this.currentScale = Math.min(Math.max(this.initialScale * scale, 1), 4);
            this.setScale(this.currentScale);
            this.updateImagePosition();
        } else if (e.touches.length === 1 && e.target === img) {
            this.onGlobalMouseMove(e);
        }
    }

    onTouchEnd(e) {
        let img = this.getCurrentImage();
        if (e.touches.length === 0 && e.target === img) {
            this.onGlobalMouseUp(e);
        }
    }

    getDistance(touch1, touch2) {
        return Math.hypot(touch1.pageX - touch2.pageX, touch1.pageY - touch2.pageY);
    }

    setScale(scale) {
        const img = this.getImg();
        img.style.transform = `scale(${scale})`;
    }

    showImage(src, metadata) {
        this.content.innerHTML = `
        <div class="modal-dialog" style="display:none">(click outside image to close)</div>
        <div class="imageview_modal_inner_div">
            <div class="imageview_modal_imagewrap" id="imageview_modal_imagewrap" style="text-align:center;">
                <img class="imageview_popup_modal_img" id="imageview_popup_modal_img" style="cursor:grab;max-width:100%;object-fit:contain;" src="${window.location.origin}/${src}">
            </div>
            <div class="imageview_popup_modal_undertext">
            ${formatMetadata(metadata)}
            </div>
        </div>`;
        this.modalJq.modal('show');
        if (isLikelyMobile()) {
            // document.body.style.overflow = 'hidden'; // Prevent body scrolling

            const img = this.getImg();
            img.style.position = 'relative';
            img.style.left = '0px';
            img.style.top = '0px';
            img.style.cursor = 'grab';

            this.currentScale = 1;
            this.setScale(1);
        }
    }

    close() {
        this.isDragging = false;
        this.didDrag = false;
        this.modalJq.modal('hide');
        if (isLikelyMobile()) {
            document.body.style.overflow = '';
            this.currentScale = 1;
            const img = this.getImg();
            if (img) {
                img.style.transform = '';
                img.style.left = '0px';
                img.style.top = '0px';
            }
        }
    }

    isOpen() {
        return this.modalJq.is(':visible');
    }
}

let imageFullView = new ImageFullViewHelper();

// New Mobile Viewer
let mobileImageFullView = null;

// Initialize viewers based on device type
function initializeViewers() {
    if (isLikelyMobile()) {
        mobileImageFullView = new MobileImageFullViewHelper();
    }
}

initializeViewers();

/** Unified function to display full-screen images based on device type */
function showFullImage(src, metadata) {
    if (isLikelyMobile() && mobileImageFullView) {
        mobileImageFullView.showImage(src, metadata);
    } else {
        imageFullView.showImage(src, metadata);
    }
}

function shiftToNextImagePreview(next = true, expand = false) {
    let curImgElem = document.getElementById('current_image_img');
    if (!curImgElem) {
        return;
    }
    let expandedState = imageFullView.isOpen() ? imageFullView.copyState() : {};
    if (curImgElem.dataset.batch_id == 'history') {
        let divs = [...lastHistoryImageDiv.parentElement.children].filter(div => div.classList.contains('image-block'));
        let index = divs.findIndex(div => div == lastHistoryImageDiv);
        if (index == -1) {
            console.log(`Image preview shift failed as current image ${lastHistoryImage} is not in history area`);
            return;
        }
        let newIndex = index + (next ? 1 : -1);
        if (newIndex < 0) {
            newIndex = divs.length - 1;
        }
        else if (newIndex >= divs.length) {
            newIndex = 0;
        }
        divs[newIndex].querySelector('img').click();
        if (expand) {
            divs[newIndex].querySelector('img').click();
            showFullImage(currentImgSrc, currentMetadataVal);
            if (!isLikelyMobile()) {
                imageFullView.pasteState(expandedState);
            }
        }
        return;
    }
    let batch_area = getRequiredElementById('current_image_batch');
    let imgs = [...batch_area.getElementsByTagName('img')];
    let index = imgs.findIndex(img => img.src == curImgElem.src);
    if (index == -1) {
        let cleanSrc = (img) => img.src.length > 100 ? img.src.substring(0, 100) + '...' : img.src;
        console.log(`Image preview shift failed as current image ${cleanSrc(curImgElem)} is not in batch area set ${imgs.map(cleanSrc)}`);
        return;
    }
    let newIndex = index + (next ? 1 : -1);
    if (newIndex < 0) {
        newIndex = imgs.length - 1;
    }
    else if (newIndex >= imgs.length) {
        newIndex = 0;
    }
    let newImg = imgs[newIndex];
    let block = findParentOfClass(newImg, 'image-block');
    setCurrentImage(block.dataset.src, block.dataset.metadata, block.dataset.batch_id, newImg.dataset.previewGrow == 'true');
    if (expand) {
        showFullImage(block.dataset.src, block.dataset.metadata);
        if (!isLikelyMobile()) {
            imageFullView.pasteState(expandedState);
        }
    }
}

window.addEventListener('keydown', function(kbevent) {
    let isFullView = imageFullView.isOpen();
    let isCurImgFocused = document.activeElement &&
        (findParentOfClass(document.activeElement, 'current_image')
        || findParentOfClass(document.activeElement, 'current_image_batch')
        || document.activeElement.tagName == 'BODY');
    if (isFullView && kbevent.key == 'Escape') {
        $('#image_fullview_modal').modal('toggle');
    }
    else if ((kbevent.key == 'ArrowLeft' || kbevent.key == 'ArrowUp') && (isFullView || isCurImgFocused)) {
        shiftToNextImagePreview(false, isFullView);
    }
    else if ((kbevent.key == 'ArrowRight' || kbevent.key == 'ArrowDown') && (isFullView || isCurImgFocused)) {
        shiftToNextImagePreview(true, isFullView);
    }
    else if (kbevent.key === "Enter" && kbevent.ctrlKey && isVisible(getRequiredElementById('main_image_area'))) {
        getRequiredElementById('alt_generate_button').click();
    }
    else {
        return;
    }
    kbevent.preventDefault();
    kbevent.stopPropagation();
    return false;
});

function alignImageDataFormat() {
    let curImg = getRequiredElementById('current_image');
    let img = document.getElementById('current_image_img');
    if (!img) {
        return;
    }
    let extrasWrapper = curImg.querySelector('.current-image-extras-wrapper');
    let scale = img.dataset.previewGrow == 'true' ? 8 : 1;
    let imgWidth = img.naturalWidth * scale;
    let imgHeight = img.naturalHeight * scale;
    let ratio = imgWidth / imgHeight;
    let height = Math.min(imgHeight, curImg.offsetHeight);
    let width = Math.min(imgWidth, height * ratio);
    let remainingWidth = curImg.offsetWidth - width - 20;
    img.style.maxWidth = `calc(min(100%, ${width}px))`;
    if (remainingWidth > 30 * 16) {
        curImg.classList.remove('current_image_small');
        extrasWrapper.style.width = `${remainingWidth}px`;
        extrasWrapper.style.maxWidth = `${remainingWidth}px`;
        extrasWrapper.style.display = 'inline-block';
        img.style.maxHeight = `calc(max(15rem, 100%))`;
    }
    else {
        curImg.classList.add('current_image_small');
        extrasWrapper.style.width = '100%';
        extrasWrapper.style.maxWidth = `100%`;
        extrasWrapper.style.display = 'block';
        img.style.maxHeight = `calc(max(15rem, 100% - 5.1rem))`;
    }
}

function toggleStar(path, rawSrc) {
    genericRequest('ToggleImageStarred', {'path': path}, data => {
        let curImgImg = document.getElementById('current_image_img');
        if (curImgImg && curImgImg.dataset.src == rawSrc) {
            let button = getRequiredElementById('current_image').querySelector('.star-button');
            if (data.new_state) {
                button.classList.add('button-starred-image');
                button.innerText = 'Starred';
            }
            else {
                button.classList.remove('button-starred-image');
                button.innerText = 'Star';
            }
        }
        let batchDiv = getRequiredElementById('current_image_batch').querySelector(`.image-block[data-src="${rawSrc}"]`);
        if (batchDiv) {
            batchDiv.dataset.metadata = JSON.stringify({ ...(JSON.parse(batchDiv.dataset.metadata ?? '{}') ?? {}), is_starred: data.new_state });
            batchDiv.classList.toggle('image-block-starred', data.new_state);
        }
        let historyDiv = getRequiredElementById('imagehistorybrowser-content').querySelector(`.image-block[data-src="${rawSrc}"]`);
        if (historyDiv) {
            historyDiv.dataset.metadata = JSON.stringify({ ...(JSON.parse(historyDiv.dataset.metadata ?? '{}') ?? {}), is_starred: data.new_state });
            historyDiv.classList.toggle('image-block-starred', data.new_state);
        }
    });
}

function setCurrentImage(src, metadata = '', batchId = '', previewGrow = false, smoothAdd = false, canReparse = true) {
    currentImgSrc = src;
    currentMetadataVal = metadata;
    if ((smoothAdd || !metadata) && canReparse) {
        let image = new Image();
        image.src = src;
        image.onload = () => {
            if (!metadata) {
                parseMetadata(image, (data, parsedMetadata) => {
                    setCurrentImage(src, parsedMetadata, batchId, previewGrow, false, false);
                });
            }
            else {
                setCurrentImage(src, metadata, batchId, previewGrow, false, false);
            }
        };
        return;
    }
    let curImg = getRequiredElementById('current_image');
    let isVideo = src.endsWith(".mp4") || src.endsWith(".webm") || src.endsWith(".mov");
    let img;
    let isReuse = false;
    let srcTarget;
    if (isVideo) {
        curImg.innerHTML = '';
        img = document.createElement('video');
        img.loop = true;
        img.autoplay = true;
        img.muted = true;
        let sourceObj = document.createElement('source');
        srcTarget = sourceObj;
        sourceObj.type = `video/${src.substring(src.lastIndexOf('.') + 1)}`;
        img.appendChild(sourceObj);
    }
    else {
        img = document.getElementById('current_image_img');
        if (!img || img.tagName != 'IMG') {
            curImg.innerHTML = '';
            img = document.createElement('img');
        }
        else {
            isReuse = true;
            delete img.dataset.previewGrow;
            img.removeAttribute('width');
            img.removeAttribute('height');
        }
        srcTarget = img;
    }
    function naturalDim() {
        if (isVideo) {
            return [img.videoWidth, img.videoHeight];
        }
        else {
            return [img.naturalWidth, img.naturalHeight];
        }
    }
    img.onload = () => {
        let [width, height] = naturalDim();
        if (previewGrow || getUserSetting('centerimagealwaysgrow')) {
            img.width = width * 8;
            img.height = height * 8;
            img.dataset.previewGrow = 'true';
        }
        alignImageDataFormat();
    }
    srcTarget.src = src;
    img.className = 'current-image-img';
    img.id = 'current_image_img';
    img.dataset.src = src;
    img.dataset.batch_id = batchId;
    img.addEventListener('click', (event) => {
        event.preventDefault();
        showFullImage(src, metadata);
    });

    img.addEventListener('touchend', (event) => {
        event.preventDefault();
        showFullImage(src, metadata);
    });

    img.addEventListener('touchmove', (event) => {
        img.dataset.moved = true;
    });

    img.addEventListener('touchstart', (event) => {
        img.dataset.moved = false;
    });

    let extrasWrapper = isReuse ? document.getElementById('current-image-extras-wrapper') : createDiv('current-image-extras-wrapper', 'current-image-extras-wrapper');
    extrasWrapper.innerHTML = '';
    let buttons = createDiv(null, 'current-image-buttons');
    let imagePathClean = src;
    if (imagePathClean.startsWith("http://") || imagePathClean.startsWith("https://")) {
        imagePathClean = imagePathClean.substring(imagePathClean.indexOf('/', imagePathClean.indexOf('/') + 2));
    }
    if (imagePathClean.startsWith('/')) {
        imagePathClean = imagePathClean.substring(1);
    }
    if (imagePathClean.startsWith('Output/')) {
        imagePathClean = imagePathClean.substring('Output/'.length);
    }
    if (imagePathClean.startsWith('View/')) {
        imagePathClean = imagePathClean.substring('View/'.length);
        let firstSlash = imagePathClean.indexOf('/');
        if (firstSlash != -1) {
            imagePathClean = imagePathClean.substring(firstSlash + 1);
        }
    }
    let buttonsChoice = getUserSetting('ButtonsUnderMainImages', '');
    if (buttonsChoice == '')
    {
        buttonsChoice = 'Use As Init,Edit Image,Star,Reuse Parameters';
    }
    buttonsChoice = buttonsChoice.toLowerCase().replaceAll(' ', '').split(',');
    let subButtons = [];
    function includeButton(name, action, extraClass = '', title = '') {
        let checkName = name.toLowerCase().replaceAll(' ', '');
        if (checkName == 'starred') {
            checkName = 'star';
        }
        if (buttonsChoice.includes(checkName)) {
            quickAppendButton(buttons, name, (e, button) => action(button), extraClass, title);
        }
        else {
            subButtons.push({ key: name, action: action });
        }
    }
    includeButton('Use As Init', () => {
        let initImageParam = document.getElementById('input_initimage');
        if (initImageParam) {
            let tmpImg = new Image();
            tmpImg.crossOrigin = 'Anonymous';
            tmpImg.onload = () => {
                let canvas = document.createElement('canvas');
                canvas.width = tmpImg.naturalWidth;
                canvas.height = tmpImg.naturalHeight;
                let ctx = canvas.getContext('2d');
                ctx.drawImage(tmpImg, 0, 0);
                canvas.toBlob(blob => {
                    let type = img.src.substring(img.src.lastIndexOf('.') + 1);
                    let file = new File([blob], imagePathClean, { type: `image/${type.length > 0 && type.length < 20 ? type : 'png'}` });
                    let container = new DataTransfer();
                    container.items.add(file);
                    initImageParam.files = container.files;
                    triggerChangeFor(initImageParam);
                    toggleGroupOpen(initImageParam, true);
                    let toggler = getRequiredElementById('input_group_content_initimage_toggle');
                    toggler.checked = true;
                    triggerChangeFor(toggler);
                });
            };
            tmpImg.src = img.src;
        }
    }, '', 'Sets this image as the Init Image parameter input');
    includeButton('Edit Image', () => {
        let initImageGroupToggle = document.getElementById('input_group_content_initimage_toggle');
        if (initImageGroupToggle) {
            initImageGroupToggle.checked = true;
            triggerChangeFor(initImageGroupToggle);
        }
        let initImageParam = document.getElementById('input_initimage');
        if (!initImageParam) {
            showError('Cannot use "Edit Image": Init Image parameter not found\nIf you have a custom workflow, deactivate it, or add an Init Image parameter.');
            return;
        }
        imageEditor.setBaseImage(img);
        imageEditor.activate();
    }, '', 'Opens an Image Editor for this image');
    includeButton('Upscale 2x', () => {
        toDataURL(img.src, (url => {
            let [width, height] = naturalDim();
            let input_overrides = {
                'initimage': url,
                'images': 1,
                'aspectratio': 'Custom',
                'width': width * 2,
                'height': height * 2
            };
            mainGenHandler.doGenerate(input_overrides, { 'initimagecreativity': 0.4 });
        }));
    }, '', 'Runs an instant generation with this image as the input and scale doubled');
    let metaParsed = { is_starred: false };
    if (metadata) {
        try {
            metaParsed = JSON.parse(metadata) || metaParsed;
        }
        catch (e) {
            console.log(`Error parsing metadata for image: ${e}, metadata was ${metadata}`);
        }
    }
    includeButton(metaParsed.is_starred ? 'Starred' : 'Star', (e, button) => {
        toggleStar(imagePathClean, src);
    }, (metaParsed.is_starred ? ' star-button button-starred-image' : ' star-button'), 'Toggles this image as starred - starred images get moved to a separate folder and highlighted');
    includeButton('Reuse Parameters', copy_current_image_params, '', 'Copies the parameters used to generate this image to the current generation settings');
    includeButton('View In History', () => {
        let folder = imagePathClean;
        let lastSlash = folder.lastIndexOf('/');
        if (lastSlash != -1) {
            folder = folder.substring(0, lastSlash);
        }
        getRequiredElementById('imagehistorytabclickable').click();
        imageHistoryBrowser.navigate(folder);
    }, '', 'Jumps the Image History browser to where this image is at.');
    for (let added of buttonsForImage(imagePathClean, src)) {
        if (added.label == 'Star') {
            continue;
        }
        if (added.href) {
            subButtons.push({ key: added.label, href: added.href, is_download: added.is_download });
        }
        else {
            includeButton(added.label, added.onclick, '', '');
        }
    }
    quickAppendButton(buttons, 'More &#x2B9F;', (e, button) => {
        let rect = button.getBoundingClientRect();
        new AdvancedPopover('image_more_popover', subButtons, false, rect.x, rect.y + button.offsetHeight + 6, document.body, null);

    });
    extrasWrapper.appendChild(buttons);
    let data = createDiv(null, 'current-image-data');
    data.innerHTML = formatMetadata(metadata);
    extrasWrapper.appendChild(data);
    if (!isReuse) {
        curImg.appendChild(img);
        curImg.appendChild(extrasWrapper);
    }
    if (isLikelyMobile()) {
        setupMobileCurrentImageExtras();

        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        extrasWrapper.style.width = '100%';

        // Enable pinch-to-zoom for the image
        img.style.touchAction = 'pinch-zoom';

        // Add event listeners for pinch-to-zoom
        let currentScale = 1;
        let startDistance = 0;

        img.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                startDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
            }
        });

        img.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault(); // Prevent default only for two-finger gestures
                const currentDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                const scale = currentDistance / startDistance;
                currentScale *= scale;
                currentScale = Math.min(Math.max(1, currentScale), 4); // Limit zoom between 1x and 4x
                img.style.transform = `scale(${currentScale})`;
                startDistance = currentDistance;
            }
        });

        img.addEventListener('touchend', () => {
            if (currentScale === 1) {
                img.style.transform = '';
            }
        });

    }
}

function appendImage(container, imageSrc, batchId, textPreview, metadata = '', type = 'legacy', prepend = true) {
    if (typeof container == 'string') {
        container = getRequiredElementById(container);
    }
    container.dataset.numImages = (container.dataset.numImages ?? 0) + 1;
    let div = createDiv(null, `image-block image-block-${type} image-batch-${batchId == "folder" ? "folder" : (container.dataset.numImages % 2 ? "1" : "0")}`);
    div.dataset.batch_id = batchId;
    div.dataset.preview_text = textPreview;
    div.dataset.src = imageSrc;
    div.dataset.metadata = metadata;
    let img = document.createElement('img');
    img.addEventListener('load', () => {
        if (batchId != "folder") {
            let ratio = img.naturalWidth / img.naturalHeight;
            div.style.width = `calc(${roundToStr(ratio * 10, 2)}rem + 2px)`;
        }
    });
    img.src = imageSrc;
    div.appendChild(img);
    if (type == 'legacy') {
        let textBlock = createDiv(null, 'image-preview-text');
        textBlock.innerText = textPreview;
        div.appendChild(textBlock);
    }
    if (prepend) {
        container.prepend(div);
    }
    else {
        container.appendChild(div);
    }
    return div;
}

function gotImageResult(image, metadata, batchId) {
    updateGenCount();
    let src = image;
    let fname = src && src.includes('/') ? src.substring(src.lastIndexOf('/') + 1) : src;
    let batch_div = appendImage('current_image_batch', src, batchId, fname, metadata, 'batch');
    batch_div.addEventListener('click', () => clickImageInBatch(batch_div));
    if (!document.getElementById('current_image_img') || autoLoadImagesElem.checked) {
        setCurrentImage(src, metadata, batchId, false, true);
        if (getUserSetting('AutoSwapImagesIncludesFullView') && imageFullView.isOpen()) {
            showFullImage(src, metadata);
        }
    }
    return batch_div;
}

function gotImagePreview(image, metadata, batchId) {
    updateGenCount();
    let src = image;
    let fname = src && src.includes('/') ? src.substring(src.lastIndexOf('/') + 1) : src;
    let batch_div = appendImage('current_image_batch', src, batchId, fname, metadata, 'batch', true);
    batch_div.querySelector('img').dataset.previewGrow = 'true';
    batch_div.addEventListener('click', () => clickImageInBatch(batch_div));
    if (!document.getElementById('current_image_img') || (autoLoadPreviewsElem.checked && image != 'imgs/model_placeholder.jpg')) {
        setCurrentImage(src, metadata, batchId, true);
    }
    return batch_div;
}

let originalPageTitle = document.title;

let generatingPreviewsText = translatable('Generating live previews...');
let waitingOnModelLoadText = translatable('waiting on model load');
let generatingText = translatable('generating');

function updateCurrentStatusDirect(data) {
    if (data) {
        num_current_gens = data.waiting_gens;
        num_models_loading = data.loading_models;
        num_live_gens = data.live_gens;
        num_backends_waiting = data.waiting_backends;
    }
    let total = num_current_gens + num_models_loading + num_live_gens + num_backends_waiting;
    if (isGeneratingPreviews && num_current_gens <= getRequiredElementById('usersettings_maxsimulpreviews').value) {
        total = 0;
    }
    getRequiredElementById('alt_interrupt_button').classList.toggle('interrupt-button-none', total == 0);
    let oldInterruptButton = document.getElementById('interrupt_button');
    if (oldInterruptButton) {
        oldInterruptButton.classList.toggle('interrupt-button-none', total == 0);
    }
    let elems = [
        getRequiredElementById('num_jobs_span'),
        document.getElementById('num_jobs_span_mobile')
    ].filter(Boolean);
    function autoBlock(num, text) {
        if (num == 0) {
            return '';
        }
        return `<span class="interrupt-line-part">${num} ${text.replaceAll('%', autoS(num))},</span> `;
    }
    let timeEstimate = '';
    if (total > 0 && mainGenHandler.totalGensThisRun > 0) {
        let avgGenTime = mainGenHandler.totalGenRunTime / mainGenHandler.totalGensThisRun;
        let estTime = avgGenTime * total;
        timeEstimate = ` (est. ${durationStringify(estTime)})`;
    }
    let content = total == 0 ? (isGeneratingPreviews ? translatableText.get() : '') : `${autoBlock(num_current_gens, 'current generation%')}${autoBlock(num_live_gens, 'running')}${autoBlock(num_backends_waiting, 'queued')}${autoBlock(num_models_loading, waitingOnModelLoadText.get())} ${timeEstimate}...`;
    elems.forEach(elem => {
        if (elem) elem.innerHTML = content;
    });
    let max = Math.max(num_current_gens, num_models_loading, num_live_gens, num_backends_waiting);
    document.title = total == 0 ? originalPageTitle : `(${max} ${generatingText.get()}) ${originalPageTitle}`;
}

let doesHaveGenCountUpdateQueued = false;

function updateGenCount() {
    updateCurrentStatusDirect(null);
    if (doesHaveGenCountUpdateQueued) {
        return;
    }
    doesHaveGenCountUpdateQueued = true;
    setTimeout(() => {
        reviseStatusBar();
    }, 500);
}

function makeWSRequestT2I(url, in_data, callback, errorHandle = null) {
    makeWSRequest(url, in_data, data => {
        if (data.status) {
            updateCurrentStatusDirect(data.status);
        }
        else {
            callback(data);
        }
    }, 0, errorHandle);
}

function doInterrupt(allSessions = false) {
    genericRequest('InterruptAll', {'other_sessions': allSessions}, data => {
        updateGenCount();
    });
    if (isGeneratingForever) {
        toggleGenerateForever();
    }
}
let genForeverInterval, genPreviewsInterval;

let lastGenForeverParams = null;

function doGenForeverOnce(minQueueSize) {
    if (num_current_gens >= minQueueSize) {
        return;
    }
    let allParams = getGenInput();
    if (!('seed' in allParams) || allParams['seed'] != -1) {
        if (lastGenForeverParams && JSON.stringify(lastGenForeverParams) == JSON.stringify(allParams)) {
            return;
        }
        lastGenForeverParams = allParams;
    }
    mainGenHandler.doGenerate();
}

function toggleGenerateForever() {
    let button = getRequiredElementById('generate_forever_button');
    isGeneratingForever = !isGeneratingForever;
    if (isGeneratingForever) {
        button.innerText = 'Stop Generating';
        let delaySeconds = parseFloat(getUserSetting('generateforeverdelay', '0.1'));
        let minQueueSize = Math.max(1, parseInt(getUserSetting('generateforeverqueuesize', '1')));
        let delayMs = Math.max(parseInt(delaySeconds * 1000), 1);
        genForeverInterval = setInterval(() => {
            doGenForeverOnce(minQueueSize);
        }, delayMs);
    }
    else {
        button.innerText = 'Generate Forever';
        clearInterval(genForeverInterval);
    }
}

let lastPreviewParams = null;

function genOnePreview() {
    let allParams = getGenInput();
    if (lastPreviewParams && JSON.stringify(lastPreviewParams) == JSON.stringify(allParams)) {
        return;
    }
    lastPreviewParams = allParams;
    let previewPreset = allPresets.find(p => p.title == 'Preview');
    let input_overrides = {};
    if (previewPreset) {
        for (let key of Object.keys(previewPreset.param_map)) {
            let param = gen_param_types.filter(p => p.id == key)[0];
            if (param) {
                let val = previewPreset.param_map[key];
                let elem = document.getElementById(`input_${param.id}`);
                if (elem) {
                    let rawVal = getInputVal(elem);
                    if (typeof val == "string" && val.includes("{value}")) {
                        val = val.replace("{value}", elem.value);
                    }
                    else if (key == 'loras' && rawVal) {
                        val = rawVal + "," + val;
                    }
                    else if (key == 'loraweights' && rawVal) {
                        val = rawVal + "," + val;
                    }
                    input_overrides[key] = val;
                }
            }
        }
    }
    input_overrides['_preview'] = true;
    input_overrides['donotsave'] = true;
    input_overrides['images'] = 1;
    for (let param of gen_param_types) {
        if (param.do_not_preview) {
            input_overrides[param.id] = null;
        }
    }
    mainGenHandler.doGenerate(input_overrides);
}

function needsNewPreview() {
    if (!isGeneratingPreviews) {
        return;
    }
    let max = getRequiredElementById('usersettings_maxsimulpreviews').value;
    if (num_current_gens < max) {
        genOnePreview();
    }
}

getRequiredElementById('alt_prompt_textbox').addEventListener('input', () => needsNewPreview());

function toggleGeneratePreviews(override_preview_req = false) {
    if (!isGeneratingPreviews) {
        let previewPreset = allPresets.find(p => p.title == 'Preview');
        if (!previewPreset && !override_preview_req) {
            let autoButtonArea = getRequiredElementById('gen_previews_autobutton');
            let lcm = coreModelMap['LoRA'].find(m => m.toLowerCase().includes('sdxl_lcm'));
            if (lcm) {
                autoButtonArea.innerHTML = `<hr>You have a LoRA named "${escapeHtml(lcm)}" available - would you like to autogenerate a Preview preset? <button class="btn btn-primary">Generate Preview Preset</button>`;
                autoButtonArea.querySelector('button').addEventListener('click', () => {
                    let toSend = {
                        'is_edit': false,
                        'title': 'Preview',
                        'description': '(Auto-generated) LCM Preview Preset, used when "Generate Previews" is clicked',
                        'param_map': {
                            'loras': lcm,
                            'loraweights': '1',
                            'steps': 4,
                            'cfgscale': 1,
                            'sampler': 'lcm',
                            'scheduler': 'normal'
                        }
                    };
                    genericRequest('AddNewPreset', toSend, data => {
                        if (Object.keys(data).includes("preset_fail")) {
                            gen_previews_autobutton.innerText = data.preset_fail;
                            return;
                        }
                        loadUserData(() => {
                            $('#gen_previews_missing_preset_modal').modal('hide');
                            toggleGeneratePreviews();
                        });
                    });
                });
            }
            $('#gen_previews_missing_preset_modal').modal('show');
            return;
        }
    }
    let button = getRequiredElementById('generate_previews_button');
    isGeneratingPreviews = !isGeneratingPreviews;
    if (isGeneratingPreviews) {
        let seed = document.getElementById('input_seed');
        if (seed && seed.value == -1) {
            seed.value = 1;
        }
        button.innerText = 'Stop Generating Previews';
        genPreviewsInterval = setInterval(() => {
            if (num_current_gens == 0) {
                genOnePreview();
            }
        }, 100);
    }
    else {
        button.innerText = 'Generate Previews';
        clearInterval(genPreviewsInterval);
    }
}

function listImageHistoryFolderAndFiles(path, isRefresh, callback, depth) {
    let sortBy = localStorage.getItem('image_history_sort_by') ?? 'Name';
    let reverse = localStorage.getItem('image_history_sort_reverse') == 'true';
    let sortElem = document.getElementById('image_history_sort_by');
    let sortReverseElem = document.getElementById('image_history_sort_reverse');
    let fix = null;
    if (sortElem) {
        sortBy = sortElem.value;
        reverse = sortReverseElem.checked;
    }
    else if (!isLikelyMobile()) { // first call happens before headers are added built atm
        fix = () => {
            let sortElem = document.getElementById('image_history_sort_by');
            let sortReverseElem = document.getElementById('image_history_sort_reverse');
            sortElem.value = sortBy;
            sortReverseElem.checked = reverse;
            sortElem.addEventListener('change', () => {
                localStorage.setItem('image_history_sort_by', sortElem.value);
                imageHistoryBrowser.update();
            });
            sortReverseElem.addEventListener('change', () => {
                localStorage.setItem('image_history_sort_reverse', sortReverseElem.checked);
                imageHistoryBrowser.update();
            });
        }
    }
    let prefix = path == '' ? '' : (path.endsWith('/') ? path : `${path}/`);
    genericRequest('ListImages', {'path': path, 'depth': depth, 'sortBy': sortBy, 'sortReverse': reverse}, data => {
        let folders = data.folders.sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase()));
        function isPreSortFile(f) {
            return f.src == 'index.html'; // Grid index files
        }
        let preFiles = data.files.filter(f => isPreSortFile(f));
        let postFiles = data.files.filter(f => !isPreSortFile(f));
        data.files = preFiles.concat(postFiles);
        let mapped = data.files.map(f => {
            let fullSrc = `${prefix}${f.src}`;
            return { 'name': fullSrc, 'data': { 'src': `${getImageOutPrefix()}/${fullSrc}`, 'fullsrc': fullSrc, 'name': f.src, 'metadata': f.metadata } };
        });
        callback(folders, mapped);
        if (fix) {
            fix();
        }
    });
}

function buttonsForImage(fullsrc, src) {
    return [
        {
            label: 'Star',
            onclick: (e) => {
                toggleStar(fullsrc, src);
            }
        },
        {
            label: 'Open In Folder',
            onclick: (e) => {
                genericRequest('OpenImageFolder', {'path': fullsrc}, data => {});
            }
        },
        {
            label: 'Download',
            href: src,
            is_download: true
        },
        {
            label: 'Delete',
            onclick: (e) => {
                genericRequest('DeleteImage', {'path': fullsrc}, data => {
                    if (e) {
                        e.remove();
                    }
                    else {
                        let historySection = getRequiredElementById('imagehistorybrowser-content');
                        let div = historySection.querySelector(`.image-block[data-src="${src}"]`);
                        if (div) {
                            div.remove();
                        }
                        div = getRequiredElementById('current_image_batch').querySelector(`.image-block[data-src="${src}"]`);
                        if (div) {
                            div.remove();
                        }
                    }
                    let currentImage = document.getElementById('current_image_img');
                    if (currentImage && currentImage.dataset.src == src) {
                        forceShowWelcomeMessage();
                    }
                });
            }
        }
    ];
}

function describeImage(image) {
    let buttons = buttonsForImage(image.data.fullsrc, image.data.src);
    let parsedMeta = { is_starred: false };
    if (image.data.metadata) {
        let metadata = image.data.metadata;
        try {
            metadata = interpretMetadata(image.data.metadata);
            parsedMeta = JSON.parse(metadata) || parsedMeta;
        }
        catch (e) {
            console.log(`Failed to parse image metadata: ${e}, metadata was ${metadata}`);
        }
    }
    let description = image.data.name + "\n" + formatMetadata(image.data.metadata);
    let name = image.data.name;
    let dragImage = image.data.src.endsWith('.html') ? 'imgs/html.jpg' : `${image.data.src}`;
    let imageSrc = image.data.src.endsWith('.html') ? 'imgs/html.jpg' : `${image.data.src}?preview=true`;
    let searchable = description;
    return { name, description, buttons, 'image': imageSrc, 'dragimage': dragImage, className: parsedMeta.is_starred ? 'image-block-starred' : '', searchable, display: name };
}

function selectImageInHistory(image, div) {
    lastHistoryImage = image.data.src;
    lastHistoryImageDiv = div;
    let curImg = document.getElementById('current_image_img');
    if (curImg && curImg.dataset.src == image.data.src) {
        curImg.dataset.batch_id = 'history';
        curImg.click();
        return;
    }
    if (image.data.name.endsWith('.html')) {
        window.open(image.data.src, '_blank');
    }
    else {
        if (!div.dataset.metadata) {
            div.dataset.metadata = image.data.metadata;
            div.dataset.src = image.data.src;
        }
        setCurrentImage(image.data.src, div.dataset.metadata, 'history');
    }
}

let imageHistoryBrowser = new GenPageBrowserClass('image_history', listImageHistoryFolderAndFiles, 'imagehistorybrowser', 'Thumbnails', describeImage, selectImageInHistory,
    `<label for="image_history_sort_by">Sort:</label> <select id="image_history_sort_by"><option>Name</option><option>Date</option></select> <input type="checkbox" id="image_history_sort_reverse"> <label for="image_history_sort_reverse">Reverse</label>`);

let hasAppliedFirstRun = false;
let backendsWereLoadingEver = false;
let reviseStatusInterval = null;
let currentBackendFeatureSet = [];
let rawBackendFeatureSet = [];
let lastStatusRequestPending = 0;
function reviseStatusBar() {
    if (lastStatusRequestPending + 20 * 1000 > Date.now()) {
        return;
    }
    if (session_id == null) {
        statusBarElem.innerText = 'Loading...';
        statusBarElem.className = `top-status-bar status-bar-warn`;
        return;
    }
    lastStatusRequestPending = Date.now();
    genericRequest('GetCurrentStatus', {}, data => {
        lastStatusRequestPending = 0;
        if (JSON.stringify(data.supported_features) != JSON.stringify(currentBackendFeatureSet)) {
            rawBackendFeatureSet = data.supported_features;
            currentBackendFeatureSet = data.supported_features;
            reviseBackendFeatureSet();
            hideUnsupportableParams();
        }
        doesHaveGenCountUpdateQueued = false;
        updateCurrentStatusDirect(data.status);
        let status;
        if (versionIsWrong) {
            status = { 'class': 'error', 'message': 'The server has updated since you opened the page, please refresh.' };
        }
        else {
            status = data.backend_status;
            if (data.backend_status.any_loading) {
                backendsWereLoadingEver = true;
            }
            else {
                if (!hasAppliedFirstRun) {
                    hasAppliedFirstRun = true;
                    refreshParameterValues(backendsWereLoadingEver || window.alwaysRefreshOnLoad);
                }
            }
            if (reviseStatusInterval != null) {
                if (status.class != '') {
                    clearInterval(reviseStatusInterval);
                    reviseStatusInterval = setInterval(reviseStatusBar, 2 * 1000);
                }
                else {
                    clearInterval(reviseStatusInterval);
                    reviseStatusInterval = setInterval(reviseStatusBar, 60 * 1000);
                }
            }
        }
        statusBarElem.innerText = translate(status.message);
        statusBarElem.className = `top-status-bar status-bar-${status.class}`;
    });
}

function reviseBackendFeatureSet() {
    currentBackendFeatureSet = Array.from(currentBackendFeatureSet);
    let addMe = [], removeMe = [];
    if (curModelCompatClass == 'stable-diffusion-v3-medium') {
        addMe.push('sd3');
    }
    else {
        removeMe.push('sd3');
    }
    if (curModelArch == 'Flux.1-dev') {
        addMe.push('flux-dev');
    }
    else {
        removeMe.push('flux-dev');
    }
    let anyChanged = false;
    for (let add of addMe) {
        if (!currentBackendFeatureSet.includes(add)) {
            currentBackendFeatureSet.push(add);
            anyChanged = true;
        }
    }
    for (let remove of removeMe) {
        let index = currentBackendFeatureSet.indexOf(remove);
        if (index != -1) {
            currentBackendFeatureSet.splice(index, 1);
            anyChanged = true;
        }
    }
    if (anyChanged) {
        hideUnsupportableParams();
    }
}

function serverResourceLoop() {
    if (isVisible(getRequiredElementById('Server-Info'))) {
        genericRequest('GetServerResourceInfo', {}, data => {
            let target = getRequiredElementById('resource_usage_area');
            let priorWidth = 0;
            if (target.style.minWidth) {
                priorWidth = parseFloat(target.style.minWidth.replaceAll('px', ''));
            }
            target.style.minWidth = `${Math.max(priorWidth, target.offsetWidth)}px`;
            if (data.gpus) {
                let html = '<table class="simple-table"><tr><th>Resource</th><th>ID</th><th>Temp</th><th>Usage</th><th>Mem Usage</th><th>Used Mem</th><th>Free Mem</th><th>Total Mem</th></tr>';
                html += `<tr><td>CPU</td><td>...</td><td>...</td><td>${Math.round(data.cpu.usage * 100)}% (${data.cpu.cores} cores)</td><td>${Math.round(data.system_ram.used / data.system_ram.total * 100)}%</td><td>${fileSizeStringify(data.system_ram.used)}</td><td>${fileSizeStringify(data.system_ram.free)}</td><td>${fileSizeStringify(data.system_ram.total)}</td></tr>`;
                for (let gpu of Object.values(data.gpus)) {
                    html += `<tr><td>${gpu.name}</td><td>${gpu.id}</td><td>${gpu.temperature}&deg;C</td><td>${gpu.utilization_gpu}% Core, ${gpu.utilization_memory}% Mem</td><td>${Math.round(gpu.used_memory / gpu.total_memory * 100)}%</td><td>${fileSizeStringify(gpu.used_memory)}</td><td>${fileSizeStringify(gpu.free_memory)}</td><td>${fileSizeStringify(gpu.total_memory)}</td></tr>`;
                }
                html += '</table>';
                target.innerHTML = html;
            }
        });
        genericRequest('ListConnectedUsers', {}, data => {
            let target = getRequiredElementById('connected_users_list');
            let priorWidth = 0;
            if (target.style.minWidth) {
                priorWidth = parseFloat(target.style.minWidth.replaceAll('px', ''));
            }
            target.style.minWidth = `${Math.max(priorWidth, target.offsetWidth)}px`;
            let html = '<table class="simple-table"><tr><th>Name</th><th>Last Active</th><th>Active Sessions</th></tr>';
            for (let user of data.users) {
                html += `<tr><td>${user.id}</td><td>${user.last_active}</td><td>${user.active_sessions.map(sess => `${sess.count}x from ${sess.address}`).join(', ')}</td></tr>`;
            }
            html += '</table>';
            target.innerHTML = html;
        });
    }
    if (isVisible(backendsListView)) {
        backendLoopUpdate();
    }
}

let toolSelector = getRequiredElementById('tool_selector');
let toolContainer = getRequiredElementById('tool_container');

function genToolsList() {
    let altGenerateButton = getRequiredElementById('alt_generate_button');
    let altGenerateButtonMobile = document.getElementById('alt_generate_button_mobile');
    let oldGenerateButton = document.getElementById('generate_button');
    let altGenerateButtonRawText = altGenerateButton.innerText;
    let altGenerateButtonRawOnClick = altGenerateButton.onclick;
    toolSelector.value = '';
    // TODO: Dynamic-from-server option list generation
    toolSelector.addEventListener('change', () => {
        for (let opened of toolContainer.getElementsByClassName('tool-open')) {
            opened.classList.remove('tool-open');
        }
        altGenerateButton.innerText = altGenerateButtonRawText;
        altGenerateButton.onclick = altGenerateButtonRawOnClick;
        if (oldGenerateButton) {
            oldGenerateButton.innerText = altGenerateButtonRawText;
        }
        let tool = toolSelector.value;
        if (tool == '') {
            return;
        }
        let div = getRequiredElementById(`tool_${tool}`);
        div.classList.add('tool-open');
        let override = toolOverrides[tool];
        if (override) {
            altGenerateButton.innerText = override.text;
            altGenerateButton.onclick = override.run;
            if (oldGenerateButton) {
                oldGenerateButton.innerText = override.text;
            }
            if (altGenerateButtonMobile && isVisible(altGenerateButtonMobile)) {
                altGenerateButtonMobile.onclick = override.run;
            }
        }
    });
}

let toolOverrides = {};

function registerNewTool(id, name, genOverride = null, runOverride = null) {
    let option = document.createElement('option');
    option.value = id;
    option.innerText = name;
    toolSelector.appendChild(option);
    let div = createDiv(`tool_${id}`, 'tool');
    toolContainer.appendChild(div);
    if (genOverride) {
        toolOverrides[id] = { 'text': genOverride, 'run': runOverride };
    }
    return div;
}

let pageBarTop = -1;
let pageBarTop2 = -1;
let pageBarMid = -1;
let imageEditorSizeBarVal = -1;
let midForceToBottom = localStorage.getItem('barspot_midForceToBottom') == 'true';
let leftShut = localStorage.getItem('barspot_leftShut') == 'true';

let setPageBarsFunc;
let altPromptSizeHandleFunc;

let layoutResets = [];

function resetPageSizer() {
    for (let localStore of Object.keys(localStorage).filter(k => k.startsWith('barspot_'))) {
        localStorage.removeItem(localStore);
    }
    pageBarTop = -1;
    pageBarTop2 = -1;
    pageBarMid = -1;
    imageEditorSizeBarVal = -1;
    midForceToBottom = false;
    leftShut = false;
    setPageBarsFunc();
    for (let runnable of layoutResets) {
        runnable();
    }
}

function tweakNegativePromptBox() {
    let altNegText = getRequiredElementById('alt_negativeprompt_textbox');
    let cfgScale = document.getElementById('input_cfgscale');
    let cfgScaleVal = cfgScale ? parseFloat(cfgScale.value) : 7;
    if (cfgScaleVal == 1) {
        altNegText.classList.add('alt-negativeprompt-textbox-invalid');
        altNegText.placeholder = translate(`Negative Prompt is not available when CFG Scale is 1`);
    }
    else {
        altNegText.classList.remove('alt-negativeprompt-textbox-invalid');
        altNegText.placeholder = translate(`Optionally, type a negative prompt here...`);
    }
    altNegText.title = altNegText.placeholder;
}

function pageSizer() {
    let topSplit = getRequiredElementById('t2i-top-split-bar');
    let topSplit2 = getRequiredElementById('t2i-top-2nd-split-bar');
    let midSplit = getRequiredElementById('t2i-mid-split-bar');
    let topBar = getRequiredElementById('t2i_top_bar');
    let bottomInfoBar = getRequiredElementById('bottom_info_bar');
    let bottomBarContent = getRequiredElementById('t2i_bottom_bar_content');
    let inputSidebar = getRequiredElementById('input_sidebar');
    let mainInputsAreaWrapper = getRequiredElementById('main_inputs_area_wrapper');
    let mainImageArea = getRequiredElementById('main_image_area');
    let currentImage = getRequiredElementById('current_image');
    let currentImageBatch = getRequiredElementById('current_image_batch_wrapper');
    let currentImageBatchCore = getRequiredElementById('current_image_batch');
    let midSplitButton = getRequiredElementById('t2i-mid-split-quickbutton');
    let topSplitButton = getRequiredElementById('t2i-top-split-quickbutton');
    let altRegion = getRequiredElementById('alt_prompt_region');
    let altText = getRequiredElementById('alt_prompt_textbox');
    let altNegText = getRequiredElementById('alt_negativeprompt_textbox');
    let altImageRegion = getRequiredElementById('alt_prompt_extra_area');
    let editorSizebar = getRequiredElementById('image_editor_sizebar');
    let topDrag = false;
    let topDrag2 = false;
    let midDrag = false;
    let imageEditorSizeBarDrag = false;
    let isSmallWindow = window.innerWidth < 768 || window.innerHeight < 768;
    if(isLikelyMobile()) {
        topSplit.style.display = "none";
        topSplit2.style.display = "none";
        topSplitButton.style.display = "none";
        midSplit.style.display = "none";
        midSplitButton.style.display = "none";
    }
    function setPageBars() {
        tweakNegativePromptBox();
        if (altRegion.style.display != 'none') {
            altText.style.height = 'auto';
            altText.style.height = `calc(min(15rem, ${Math.max(altText.scrollHeight, 15) + 5}px))`;
            altNegText.style.height = 'auto';
            altNegText.style.height = `calc(min(15rem, ${Math.max(altNegText.scrollHeight, 15) + 5}px))`;
            altRegion.style.top = `calc(-${altText.offsetHeight + altNegText.offsetHeight + altImageRegion.offsetHeight}px - 2rem)`;
        }
        setCookie('barspot_pageBarTop', pageBarTop, 365);
        setCookie('barspot_pageBarTop2', pageBarTop2, 365);
        setCookie('barspot_pageBarMidPx', pageBarMid, 365);
        setCookie('barspot_imageEditorSizeBar', imageEditorSizeBarVal, 365);
        let barTopLeft = leftShut ? `0px` : pageBarTop == -1 ? (isSmallWindow ? `14rem` : `28rem`) : `${pageBarTop}px`;
        let barTopRight = pageBarTop2 == -1 ? (isSmallWindow ? `4rem` : `21rem`) : `${pageBarTop2}px`;
        let curImgWidth = `100vw - ${barTopLeft} - ${barTopRight} - 10px`;
        // TODO: this 'eval()' hack to read the size in advance is a bit cursed.
        let fontRem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        let curImgWidthNum = eval(curImgWidth.replace(/vw/g, `* ${window.innerWidth * 0.01}`).replace(/rem/g, `* ${fontRem}`).replace(/px/g, ''));
        if (curImgWidthNum < 400) {
            barTopRight = `${barTopRight} + ${400 - curImgWidthNum}px`;
            curImgWidth = `100vw - ${barTopLeft} - ${barTopRight} - 10px`;
        }
        inputSidebar.style.width = `${barTopLeft}`;
        mainInputsAreaWrapper.classList[pageBarTop < 350 ? "add" : "remove"]("main_inputs_small");
        mainInputsAreaWrapper.style.width = `${barTopLeft}`;
        if (!isLikelyMobile()) inputSidebar.style.display = leftShut ? 'none' : '';
        altRegion.style.width = `calc(100vw - ${barTopLeft} - ${barTopRight} - 10px)`;
        if(!isLikelyMobile()) mainImageArea.style.width = `calc(100vw - ${barTopLeft})`;
        mainImageArea.scrollTop = 0;
        if (imageEditor.active) {
            let imageEditorSizePercent = imageEditorSizeBarVal < 0 ? 0.5 : (imageEditorSizeBarVal / 100.0);
            imageEditor.inputDiv.style.width = `calc((${curImgWidth}) * ${imageEditorSizePercent} - 3px)`;
            currentImage.style.width = `calc((${curImgWidth}) * ${(1.0 - imageEditorSizePercent)} - 3px)`;
        }
        else {
            currentImage.style.width = `calc(${curImgWidth})`;
        }
        currentImageBatch.style.width = `calc(${barTopRight} - 22px)`;
        if (currentImageBatchCore.offsetWidth < 425) {
            currentImageBatchCore.classList.add('current_image_batch_core_small');
        }
        else {
            currentImageBatchCore.classList.remove('current_image_batch_core_small');
        }
        topSplitButton.innerHTML = leftShut ? '&#x21DB;' : '&#x21DA;';
        midSplitButton.innerHTML = midForceToBottom ? '&#x290A;' : '&#x290B;';
        let altHeight = altRegion.style.display == 'none' ? '0px' : `(${altText.offsetHeight + altNegText.offsetHeight + altImageRegion.offsetHeight}px + 2rem)`;
        if (pageBarMid != -1 || midForceToBottom) {
            let fixed = midForceToBottom ? `6.5rem` : `${pageBarMid}px`;
            topSplit.style.height = `calc(100vh - ${fixed})`;
            topSplit2.style.height = `calc(100vh - ${fixed})`;
            if (!isLikelyMobile()) inputSidebar.style.height = `calc(100vh - ${fixed})`;
            mainInputsAreaWrapper.style.height = `calc(100vh - ${fixed})`;
            mainImageArea.style.height = `calc(100vh - ${fixed})`;
            currentImage.style.height = `calc(100vh - ${fixed} - ${altHeight})`;
            imageEditor.inputDiv.style.height = `calc(100vh - ${fixed} - ${altHeight})`;
            editorSizebar.style.height = `calc(100vh - ${fixed} - ${altHeight})`;
            currentImageBatch.style.height = `calc(100vh - ${fixed})`;
            topBar.style.height = `calc(100vh - ${fixed})`;
            let bottomBarHeight = bottomInfoBar.offsetHeight;
            bottomBarContent.style.height = `calc(${fixed} - ${bottomBarHeight}px)`;
        }
        else {
            topSplit.style.height = '';
            topSplit2.style.height = '';
            inputSidebar.style.height = '';
            mainInputsAreaWrapper.style.height = '';
            mainImageArea.style.height = '';
            currentImage.style.height = `calc(49vh - ${altHeight})`;
            imageEditor.inputDiv.style.height = `calc(49vh - ${altHeight})`;
            editorSizebar.style.height = `calc(49vh - ${altHeight})`;
            currentImageBatch.style.height = '';
            topBar.style.height = '';
            bottomBarContent.style.height = '';
        }
        imageEditor.resize();
        alignImageDataFormat();
        imageHistoryBrowser.makeVisible(getRequiredElementById('t2i_bottom_bar'));
    }
    setPageBarsFunc = setPageBars;
    let cookieA = getCookie('barspot_pageBarTop');
    if (cookieA) {
        pageBarTop = parseInt(cookieA);
    }
    let cookieB = getCookie('barspot_pageBarTop2');
    if (cookieB) {
        pageBarTop2 = parseInt(cookieB);
    }
    let cookieC = getCookie('barspot_pageBarMidPx');
    if (cookieC) {
        pageBarMid = parseInt(cookieC);
    }
    let cookieD = getCookie('barspot_imageEditorSizeBar');
    if (cookieD) {
        imageEditorSizeBarVal = parseInt(cookieD);
    }
    setPageBars();
    topSplit.addEventListener('mousedown', (e) => {
        topDrag = true;
        e.preventDefault();
    }, true);
    topSplit2.addEventListener('mousedown', (e) => {
        topDrag2 = true;
        e.preventDefault();
    }, true);
    topSplit.addEventListener('touchstart', (e) => {
        topDrag = true;
        e.preventDefault();
    }, true);
    topSplit2.addEventListener('touchstart', (e) => {
        topDrag2 = true;
        e.preventDefault();
    }, true);
    editorSizebar.addEventListener('mousedown', (e) => {
        imageEditorSizeBarDrag = true;
        e.preventDefault();
    }, true);
    editorSizebar.addEventListener('touchstart', (e) => {
        imageEditorSizeBarDrag = true;
        e.preventDefault();
    }, true);
    function setMidForce(val) {
        midForceToBottom = val;
        localStorage.setItem('barspot_midForceToBottom', midForceToBottom);
    }
    function setLeftShut(val) {
        leftShut = val;
        localStorage.setItem('barspot_leftShut', leftShut);
    }
    midSplit.addEventListener('mousedown', (e) => {
        if (e.target == midSplitButton) {
            return;
        }
        midDrag = true;
        setMidForce(false);
        e.preventDefault();
    }, true);
    midSplit.addEventListener('touchstart', (e) => {
        if (e.target == midSplitButton) {
            return;
        }
        midDrag = true;
        setMidForce(false);
        e.preventDefault();
    }, true);
    midSplitButton.addEventListener('click', (e) => {
        midDrag = false;
        setMidForce(!midForceToBottom);
        pageBarMid = Math.max(pageBarMid, 400);
        setPageBars();
        e.preventDefault();
    }, true);
    topSplitButton.addEventListener('click', (e) => {
        topDrag = false;
        setLeftShut(!leftShut);
        pageBarTop = Math.max(pageBarTop, 400);
        setPageBars();
        e.preventDefault();
        triggerChangeFor(altText);
        triggerChangeFor(altNegText);
    }, true);
    let moveEvt = (e, x, y) => {
        let offX = x;
        offX = Math.min(Math.max(offX, 100), window.innerWidth - 10);
        if (topDrag) {
            pageBarTop = Math.min(offX - 5, 51 * 16);
            setLeftShut(pageBarTop < 300);
            setPageBars();
        }
        if (topDrag2) {
            pageBarTop2 = window.innerWidth - offX + 15;
            if (pageBarTop2 < 100) {
                pageBarTop2 = 22;
            }
            setPageBars();
        }
        if (imageEditorSizeBarDrag) {
            let maxAreaWidth = imageEditor.inputDiv.offsetWidth + currentImage.offsetWidth + 10;
            let imageAreaLeft = imageEditor.inputDiv.getBoundingClientRect().left;
            let val = Math.min(Math.max(offX - imageAreaLeft + 3, 200), maxAreaWidth - 200);
            imageEditorSizeBarVal = Math.min(90, Math.max(10, val / maxAreaWidth * 100));
            setPageBars();
        }
        if (midDrag) {
            const MID_OFF = 85;
            let refY = Math.min(Math.max(e.pageY, MID_OFF), window.innerHeight - MID_OFF);
            setMidForce(refY >= window.innerHeight - MID_OFF);
            pageBarMid = window.innerHeight - refY + topBar.getBoundingClientRect().top + 3;
            setPageBars();
        }
    };
    document.addEventListener('mousemove', (e) => moveEvt(e, e.pageX, e.pageY));
    document.addEventListener('touchmove', (e) => moveEvt(e, e.touches.item(0).pageX, e.touches.item(0).pageY));
    document.addEventListener('mouseup', (e) => {
        topDrag = false;
        topDrag2 = false;
        midDrag = false;
        imageEditorSizeBarDrag = false;
    });
    document.addEventListener('touchend', (e) => {
        topDrag = false;
        topDrag2 = false;
        midDrag = false;
        imageEditorSizeBarDrag = false;
    });
    for (let tab of getRequiredElementById('bottombartabcollection').getElementsByTagName('a')) {
        tab.addEventListener('click', (e) => {
            setMidForce(false);
            setPageBars();
        });
    }
    altText.addEventListener('keydown', (e) => {
        if (e.key == 'Enter' && (e.metaKey || e.ctrlKey)) {
            altText.dispatchEvent(new Event('change'));
            getRequiredElementById('alt_generate_button').click();
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    });
    altNegText.addEventListener('keydown', (e) => {
        if (e.key == 'Enter' && !e.shiftKey) {
            altNegText.dispatchEvent(new Event('change'));
            getRequiredElementById('alt_generate_button').click();
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    });
    altText.addEventListener('input', (e) => {
        let inputPrompt = document.getElementById('input_prompt');
        if (inputPrompt) {
            inputPrompt.value = altText.value;
        }
        setCookie(`lastparam_input_prompt`, altText.value, 0.25);
        textPromptDoCount(altText, getRequiredElementById('alt_text_tokencount'));
        monitorPromptChangeForEmbed(altText.value, 'positive');
    });
    altText.addEventListener('input', () => {
        setCookie(`lastparam_input_prompt`, altText.value, 0.25);
        setPageBars();
    });
    altNegText.addEventListener('input', (e) => {
        let inputNegPrompt = document.getElementById('input_negativeprompt');
        if (inputNegPrompt) {
            inputNegPrompt.value = altNegText.value;
        }
        setCookie(`lastparam_input_negativeprompt`, altNegText.value, 0.25);
        let negTokCount = getRequiredElementById('alt_negtext_tokencount');
        if (altNegText.value == '') {
            negTokCount.style.display = 'none';
        }
        else {
            negTokCount.style.display = '';
        }
        textPromptDoCount(altNegText, negTokCount, ', Neg: ');
        monitorPromptChangeForEmbed(altNegText.value, 'negative');
    });
    altNegText.addEventListener('input', () => {
        setCookie(`lastparam_input_negativeprompt`, altNegText.value, 0.25);
        setPageBars();
    });
    function altPromptSizeHandle() {
        altRegion.style.top = `calc(-${altText.offsetHeight + altNegText.offsetHeight + altImageRegion.offsetHeight}px - 2rem)`;
        setPageBars();
    }
    altPromptSizeHandle();
    new ResizeObserver(altPromptSizeHandle).observe(altText);
    new ResizeObserver(altPromptSizeHandle).observe(altNegText);
    altPromptSizeHandleFunc = altPromptSizeHandle;
    textPromptAddKeydownHandler(altText);
    textPromptAddKeydownHandler(altNegText);
    addEventListener("resize", setPageBars);
    textPromptAddKeydownHandler(getRequiredElementById('edit_wildcard_contents'));
}

/** Clears out and resets the image-batch view, only if the user wants that. */
function resetBatchIfNeeded() {
    if (autoClearBatchElem.checked) {
        clearBatch();
    }
}

function loadUserData(callback) {
    genericRequest('GetMyUserData', {}, data => {
        autoCompletionsList = {};
        if (data.autocompletions) {
            let allSet = [];
            autoCompletionsList['all'] = allSet;
            for (let val of data.autocompletions) {
                let split = val.split('\n');
                let datalist = autoCompletionsList[val[0]];
                let entry = { name: split[0], low: split[1].replaceAll(' ', '_').toLowerCase(), clean: split[1], raw: val, count: 0 };
                if (split.length > 3) {
                    entry.tag = split[2];
                }
                if (split.length > 4) {
                    count = parseInt(split[3]) || 0;
                    if (count) {
                        entry.count = count;
                        entry.count_display = largeCountStringify(count);
                    }
                }
                if (!datalist) {
                    datalist = [];
                    autoCompletionsList[val[0]] = datalist;
                }
                datalist.push(entry);
                allSet.push(entry);
            }
        }
        else {
            autoCompletionsList = null;
        }
        allPresets = data.presets;
        if (!language) {
            language = data.language;
        }
        sortPresets();
        presetBrowser.update();
        if (shouldApplyDefault) {
            shouldApplyDefault = false;
            let defaultPreset = getPresetByTitle('default');
            if (defaultPreset) {
                applyOnePreset(defaultPreset);
            }
        }
        if (callback) {
            callback();
        }
        loadAndApplyTranslations();
    });
}

function updateAllModels(models) {
    coreModelMap = models;
    allModels = models['Stable-Diffusion'];
    let selector = getRequiredElementById('current_model');
    let selectorVal = selector.value;
    selector.innerHTML = '';
    let emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.innerText = '';
    selector.appendChild(emptyOption);
    for (let model of allModels) {
        let option = document.createElement('option');
        let clean = cleanModelName(model);
        option.value = clean;
        option.innerText = clean;
        selector.appendChild(option);
    }
    selector.value = selectorVal;
    pickle2safetensor_load();
    modelDownloader.reloadFolders();
}

let shutdownConfirmationText = translatable("Are you sure you want to shut SwarmUI down?");

function shutdown_server() {
    if (confirm(shutdownConfirmationText.get())) {
        genericRequest('ShutdownServer', {}, data => {
            close();
        });
    }
}

let restartConfirmationText = translatable("Are you sure you want to update and restart SwarmUI?");
let checkingForUpdatesText = translatable("Checking for updates...");

function update_and_restart_server() {
    let noticeArea = getRequiredElementById('shutdown_notice_area');
    if (confirm(restartConfirmationText.get())) {
        noticeArea.innerText = checkingForUpdatesText.get();
        genericRequest('UpdateAndRestart', {}, data => {
            noticeArea.innerText = data.result;
        });
    }
}

function server_clear_vram() {
    genericRequest('FreeBackendMemory', { 'system_ram': false }, data => {});
}

function server_clear_sysram() {
    genericRequest('FreeBackendMemory', { 'system_ram': true }, data => {});
}

/** Set some element titles via JavaScript (to allow '\n'). */
function setTitles() {
    getRequiredElementById('alt_prompt_textbox').title = "Tell the AI what you want to see, then press Enter to submit.\nConsider 'a photo of a cat', or 'cartoonish drawing of an astronaut'";
    getRequiredElementById('alt_interrupt_button').title = "Interrupt current generation(s)\nRight-click for advanced options.";
    getRequiredElementById('alt_generate_button').title = "Start generating images\nRight-click for advanced options.";
    let oldGenerateButton = document.getElementById('generate_button');
    if (oldGenerateButton) {
        oldGenerateButton.title = getRequiredElementById('alt_generate_button').title;
        getRequiredElementById('interrupt_button').title = getRequiredElementById('alt_interrupt_button').title;
    }
}
setTitles();

function doFeatureInstaller(path, author, name, button_div_id, alt_confirm = null, callback = null, deleteButton = true) {
    if (!confirm(alt_confirm || `This will install ${path} which is a third-party extension maintained by community developer '${author}'.\nWe cannot make any guarantees about it.\nDo you wish to install?`)) {
        return;
    }
    let buttonDiv = getRequiredElementById(button_div_id);
    buttonDiv.querySelector('button').disabled = true;
    buttonDiv.appendChild(createDiv('', null, 'Installing...'));
    genericRequest('ComfyInstallFeatures', {'feature': name}, data => {
        buttonDiv.appendChild(createDiv('', null, "Installed! Please wait while backends restart. If it doesn't work, you may need to restart Swarm."));
        reviseStatusBar();
        setTimeout(() => {
            if (deleteButton) {
                buttonDiv.remove();
            }
            hasAppliedFirstRun = false;
            reviseStatusBar();
            if (callback) {
                callback();
            }
        }, 8000);
    }, 0, (e) => {
        showError(e);
        buttonDiv.appendChild(createDiv('', null, 'Failed to install!'));
        buttonDiv.querySelector('button').disabled = false;
    });
}

function revisionInstallIPAdapter() {
    doFeatureInstaller('https://github.com/cubiq/ComfyUI_IPAdapter_plus', 'cubiq', 'ipadapter', 'revision_install_ipadapter');
}

function installControlnetPreprocessors() {
    doFeatureInstaller('https://github.com/Fannovel16/comfyui_controlnet_aux', 'Fannovel16', 'controlnet_preprocessors', 'controlnet_install_preprocessors');
}

function installVideoRife() {
    doFeatureInstaller('https://github.com/Fannovel16/ComfyUI-Frame-Interpolation', 'Fannovel16', 'frame_interpolation', 'video_install_frameinterps');
}

function installTensorRT() {
    doFeatureInstaller('https://github.com/comfyanonymous/ComfyUI_TensorRT', 'comfyanonymous + NVIDIA', 'comfyui_tensorrt', 'install_trt_button', `This will install TensorRT support developed by Comfy and NVIDIA.\nDo you wish to install?`, () => {
        getRequiredElementById('tensorrt_mustinstall').style.display = 'none';
        getRequiredElementById('tensorrt_modal_ready').style.display = '';
    });
}

function installSAM2() {
    doFeatureInstaller('https://github.com/kijai/ComfyUI-segment-anything-2', 'kijai', 'sam2', 'install_sam2_button', null, () => {
        $('#sam2_installer').modal('hide');
    }, false);
}

function installBNBNF4() {
    doFeatureInstaller('https://github.com/comfyanonymous/ComfyUI_bitsandbytes_NF4', 'comfyanonymous', 'bnb_nf4', 'install_bnbnf4_button', `This will install BnB NF4 support developed by Comfy and lllyasviel (AGPL License).\nDo you wish to install?`, () => {
        $('#bnb_nf4_installer').modal('hide');
    }, false);
}

function installGGUF() {
    doFeatureInstaller('https://github.com/city96/ComfyUI-GGUF', 'city96', 'gguf', 'install_gguf_button', `This will install GGUF support developed by city96.\nDo you wish to install?`, () => {
        $('#gguf_installer').modal('hide');
    }, false);
}

function hideRevisionInputs() {
    let promptImageArea = getRequiredElementById('alt_prompt_image_area');
    promptImageArea.innerHTML = '';
    let clearButton = getRequiredElementById('alt_prompt_image_clear_button');
    clearButton.style.display = 'none';
    let revisionGroup = document.getElementById('input_group_revision');
    let revisionToggler = document.getElementById('input_group_content_revision_toggle');
    if (revisionGroup) {
        revisionToggler.checked = false;
        triggerChangeFor(revisionToggler);
        toggleGroupOpen(revisionGroup, false);
        revisionGroup.style.display = 'none';
    }
    altPromptSizeHandleFunc();
}

function showRevisionInputs(toggleOn = false) {
    let revisionGroup = document.getElementById('input_group_revision');
    let revisionToggler = document.getElementById('input_group_content_revision_toggle');
    if (revisionGroup) {
        toggleGroupOpen(revisionGroup, true);
        if (toggleOn) {
            revisionToggler.checked = true;
            triggerChangeFor(revisionToggler);
        }
        revisionGroup.style.display = '';
    }
}

function autoRevealRevision() {
    let promptImageArea = getRequiredElementById('alt_prompt_image_area');
    if (promptImageArea.children.length > 0) {
        showRevisionInputs();
    }
    else {
        hideRevisionInputs();
    }
}

function revisionAddImage(file) {
    let clearButton = getRequiredElementById('alt_prompt_image_clear_button');
    let promptImageArea = getRequiredElementById('alt_prompt_image_area');
    let reader = new FileReader();
    reader.onload = (e) => {
        let data = e.target.result;
        let imageContainer = createDiv(null, 'alt-prompt-image-container');
        let imageRemoveButton = createSpan(null, 'alt-prompt-image-container-remove-button', '&times;');
        imageRemoveButton.addEventListener('click', (e) => {
            imageContainer.remove();
            autoRevealRevision();
            altPromptSizeHandleFunc();
        });
        imageRemoveButton.title = 'Remove this image';
        imageContainer.appendChild(imageRemoveButton);
        let imageObject = new Image();
        imageObject.src = data;
        imageObject.height = 128;
        imageObject.className = 'alt-prompt-image';
        imageObject.dataset.filedata = data;
        imageContainer.appendChild(imageObject);
        clearButton.style.display = '';
        showRevisionInputs(true);
        promptImageArea.appendChild(imageContainer);
        altPromptSizeHandleFunc();
    };
    reader.readAsDataURL(file);
}

function revisionInputHandler() {
    let dragArea = getRequiredElementById('alt_prompt_region');
    dragArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    let clearButton = getRequiredElementById('alt_prompt_image_clear_button');
    clearButton.addEventListener('click', () => {
        hideRevisionInputs();
    });
    dragArea.addEventListener('drop', (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            for (let file of e.dataTransfer.files) {
                if (file.type.startsWith('image/')) {
                    revisionAddImage(file);
                }
            }
        }
    });
}
revisionInputHandler();

function revisionImagePaste(e) {
    let items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let item of items) {
        if (item.kind === 'file') {
            let file = item.getAsFile();
            if (file.type.startsWith('image/')) {
                revisionAddImage(file);
            }
        }
    }
}

function openEmptyEditor() {
    let canvas = document.createElement('canvas');
    canvas.width = document.getElementById('input_width').value;
    canvas.height = document.getElementById('input_height').value;
    let ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let image = new Image();
    image.onload = () => {
        imageEditor.clearVars();
        imageEditor.setBaseImage(image);
        imageEditor.activate();
    };
    image.src = canvas.toDataURL();
}

function upvertAutoWebuiMetadataToSwarm(metadata) {
    let realData = {};
    // Auto webui has no "proper formal" syntax like JSON or anything,
    // just a mishmash of text, and there's no way to necessarily predict newlines/colons/etc,
    // so just make best effort to import based on some easy examples
    if (metadata.includes("\nNegative prompt: ")) {
        let parts = metadata.split("\nNegative prompt: ");
        realData['prompt'] = parts[0];
        realData['negativeprompt'] = parts[1];
        metadata = parts.slice(2).join("\n");
    }
    else {
        let lines = metadata.split('\n');
        realData['prompt'] = lines.slice(0, lines.length - 1).join('\n');
        metadata = lines[lines.length - 1];
    }
    let lines = metadata.split('\n');
    if (lines.length > 0) {
        let dataParts = lines[lines.length - 1].split(',').map(x => x.split(':').map(y => y.trim()));
        for (let part of dataParts) {
            if (part.length == 2) {
                let clean = cleanParamName(part[0]);
                if (rawGenParamTypesFromServer.find(x => x.id == clean)) {
                    realData[clean] = part[1];
                }
                else if (clean == "size") {
                    let sizeParts = part[1].split('x').map(x => parseInt(x));
                    if (sizeParts.length == 2) {
                        realData['width'] = sizeParts[0];
                        realData['height'] = sizeParts[1];
                    }
                }
                else if (clean == "scheduletype") {
                    realData["scheduler"] = part[1].toLowerCase();
                }
                else {
                    realData[part[0]] = part[1];
                }
            }
        }
    }
    return JSON.stringify({ 'sui_image_params': realData });
}

let fooocusMetadataMap = [
    ['Prompt', 'prompt'],
    ['Negative', 'negativeprompt'],
    ['cfg', 'cfgscale'],
    ['sampler_name', 'sampler'],
    ['base_model_name', 'model'],
    ['denoise', 'imageinitcreativity']
];

function remapMetadataKeys(metadata, keymap) {
    for (let pair of keymap) {
        if (pair[0] in metadata) {
            metadata[pair[1]] = metadata[pair[0]];
            delete metadata[pair[0]];
        }
    }
    for (let key in metadata) {
        if (metadata[key] == null) { // Why does Fooocus emit nulls?
            delete metadata[key];
        }
    }
    return metadata;
}

const imageMetadataKeys = ['prompt', 'Prompt', 'parameters', 'Parameters', 'userComment', 'UserComment', 'model', 'Model'];

function interpretMetadata(metadata) {
    if (metadata instanceof Uint8Array) {
        let prefix = metadata.slice(0, 8);
        let data = metadata.slice(8);
        let encodeType = new TextDecoder().decode(prefix);
        if (encodeType.startsWith('UNICODE')) {
            if (data[0] == 0 && data[1] != 0) { // This is slightly dirty detection, but it works at least for English text.
                metadata = decodeUtf16LE(data);
            }
            else {
                metadata = decodeUtf16(data);
            }
        }
        else {
            metadata = new TextDecoder().decode(data);
        }
    }
    if (metadata) {
        metadata = metadata.trim();
        if (metadata.startsWith('{')) {
            let json = JSON.parse(metadata);
            if ('sui_image_params' in json) {
                // It's swarm, we're good
            }
            else if ("Prompt" in json) {
                // Fooocus
                json = remapMetadataKeys(json, fooocusMetadataMap);
                metadata = JSON.stringify({ 'sui_image_params': json });
            }
            else {
                // Don't know - discard for now.
                metadata = null;
            }
        }
        else {
            let lines = metadata.split('\n');
            if (lines.length > 1) {
                metadata = upvertAutoWebuiMetadataToSwarm(metadata);
            }
            else {
                // ???
                metadata = null;
            }
        }
    }
    return metadata;
}

function parseMetadata(data, callback) {
    exifr.parse(data).then(parsed => {
        if (parsed && imageMetadataKeys.some(key => key in parsed)) {
            return parsed;
        }
        return exifr.parse(data, imageMetadataKeys);
    }).then(parsed => {
        let metadata = null;
        if (parsed) {
            if (parsed.parameters) {
                metadata = parsed.parameters;
            }
            else if (parsed.Parameters) {
                metadata = parsed.Parameters;
            }
            else if (parsed.prompt) {
                metadata = parsed.prompt;
            }
            else if (parsed.UserComment) {
                metadata = parsed.UserComment;
            }
            else if (parsed.userComment) {
                metadata = parsed.userComment;
            }
            else if (parsed.model) {
                metadata = parsed.model;
            }
            else if (parsed.Model) {
                metadata = parsed.Model;
            }
        }
        metadata = interpretMetadata(metadata);
        callback(data, metadata);
    }).catch(err => {
        callback(data, null);
    });
}

function imageInputHandler() {
    let imageArea = getRequiredElementById('current_image');
    imageArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    imageArea.addEventListener('drop', (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            let file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                let reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        parseMetadata(e.target.result, (data, metadata) => { setCurrentImage(data, metadata); });
                    }
                    catch (e) {
                        setCurrentImage(e.target.result, null);
                    }
                }
                reader.readAsDataURL(file);
            }
        }
    });
}
imageInputHandler();

function debugGenAPIDocs() {
    genericRequest('DebugGenDocs', { }, data => { });
}

let hashSubTabMapping = {
    'utilities_tab': 'utilitiestablist',
    'user_tab': 'usertablist',
    'server_tab': 'servertablist',
};

function updateHash() {
    let tabList = getRequiredElementById('toptablist');
    let bottomTabList = getRequiredElementById('bottombartabcollection');
    let activeTopTab = tabList.querySelector('.active');
    let activeBottomTab = bottomTabList.querySelector('.active');
    let activeTopTabHref = activeTopTab.href.split('#')[1];
    let hash = `#${activeBottomTab.href.split('#')[1]},${activeTopTabHref}`;
    let subMapping = hashSubTabMapping[activeTopTabHref];
    if (subMapping) {
        let subTabList = getRequiredElementById(subMapping);
        let activeSubTab = subTabList.querySelector('.active');
        hash += `,${activeSubTab.href.split('#')[1]}`;
    }
    else if (activeTopTabHref == 'Simple') {
        let target = simpleTab.browser.selected || simpleTab.browser.folder;
        if (target) {
            hash += `,${encodeURIComponent(target)}`;
        }
    }
    history.pushState(null, null, hash);
}

function loadHashHelper() {
    let tabList = getRequiredElementById('toptablist');
    let bottomTabList = getRequiredElementById('bottombartabcollection');
    let tabs = [... tabList.getElementsByTagName('a')];
    tabs = tabs.concat([... bottomTabList.getElementsByTagName('a')]);
    for (let subMapping of Object.values(hashSubTabMapping)) {
        tabs = tabs.concat([... getRequiredElementById(subMapping).getElementsByTagName('a')]);
    }
    if (location.hash) {
        let split = location.hash.substring(1).split(',');
        let bottomTarget = bottomTabList.querySelector(`a[href='#${split[0]}']`);
        if (bottomTarget) {
            bottomTarget.click();
        }
        let target = tabList.querySelector(`a[href='#${split[1]}']`);
        if (target) {
            target.click();
        }
        let subMapping = hashSubTabMapping[split[1]];
        if (subMapping && split.length > 2) {
            let subTabList = getRequiredElementById(subMapping);
            let subTarget = subTabList.querySelector(`a[href='#${split[2]}']`);
            if (subTarget) {
                subTarget.click();
            }
        }
        else if (split[1] == 'Simple' && split.length > 2) {
            let target = decodeURIComponent(split[2]);
            simpleTab.mustSelectTarget = target;
        }
    }
    for (let tab of tabs) {
        tab.addEventListener('click', (e) => {
            updateHash();
        });
    }
}

function storeImageToHistoryWithCurrentParams(img) {
    let data = getGenInput();
    data['image'] = img;
    delete data['initimage'];
    delete data['maskimage'];
    genericRequest('AddImageToHistory', data, res => {
        mainGenHandler.gotImageResult(res.images[0].image, res.images[0].metadata, '0');
    });
}

$('#toptablist').on('shown.bs.tab', function (e) {
    let versionDisp = getRequiredElementById('version_display');
    if (e.target.id == 'maintab_comfyworkflow') {
        versionDisp.style.display = 'none';
    }
    else {
        versionDisp.style.display = '';
    }
});

function genpageLoad() {
    console.log('Load page...');
    $('#toptablist').on('shown.bs.tab', function (e) {
        let versionDisp = getRequiredElementById('version_display');
        if (e.target.id == 'maintab_comfyworkflow') {
            versionDisp.style.display = 'none';
        }
        else {
            versionDisp.style.display = '';
        }
    });
    window.imageEditor = new ImageEditor(getRequiredElementById('image_editor_input'), true, true, () => setPageBarsFunc(), () => needsNewPreview());
    let editorSizebar = getRequiredElementById('image_editor_sizebar');
    window.imageEditor.onActivate = () => {
        editorSizebar.style.display = '';
    };
    window.imageEditor.onDeactivate = () => {
        editorSizebar.style.display = 'none';
    };
    window.imageEditor.tools['options'].optionButtons = [
        ... window.imageEditor.tools['options'].optionButtons,
        { key: 'Store Current Image To History', action: () => {
            let img = window.imageEditor.getFinalImageData();
            storeImageToHistoryWithCurrentParams(img);
        }},
        { key: 'Store Full Canvas To History', action: () => {
            let img = window.imageEditor.getMaximumImageData();
            storeImageToHistoryWithCurrentParams(img);
        }},
        { key: 'Auto Segment Image (SAM2)', action: () => {
            if (!currentBackendFeatureSet.includes('sam2')) {
                $('#sam2_installer').modal('show');
            }
            else {
                let img = window.imageEditor.getFinalImageData();
                let genData = getGenInput();
                genData['controlnetimageinput'] = img;
                genData['controlnetstrength'] = 1;
                genData['controlnetpreprocessor'] = 'Segment Anything 2 Global Autosegment base_plus';
                genData['images'] = 1;
                genData['prompt'] = '';
                delete genData['batchsize'];
                genData['donotsave'] = true;
                genData['controlnetpreviewonly'] = true;
                makeWSRequestT2I('GenerateText2ImageWS', genData, data => {
                    if (!data.image) {
                        return;
                    }
                    let newImg = new Image();
                    newImg.onload = () => {
                        imageEditor.addImageLayer(newImg);
                    };
                    newImg.src = data.image;
                });
            }
        }}
    ];
    pageSizer();
    reviseStatusBar();
    loadHashHelper();
    getSession(() => {
        console.log('First session loaded - prepping page.');
        imageHistoryBrowser.navigate('');
        initialModelListLoad();
        loadBackendTypesMenu();
        genericRequest('ListT2IParams', {}, data => {
            updateAllModels(data.models);
            allWildcards = data.wildcards;
            rawGenParamTypesFromServer = sortParameterList(data.list);
            gen_param_types = rawGenParamTypesFromServer;
            paramConfig.preInit();
            paramConfig.applyParamEdits(data.param_edits);
            paramConfig.loadUserParamConfigTab();
            genInputs();
            genToolsList();
            reviseStatusBar();
            getRequiredElementById('advanced_options_checkbox').checked = localStorage.getItem('display_advanced') == 'true';
            toggle_advanced();
            setCurrentModel();
            loadUserData();
            for (let callback of sessionReadyCallbacks) {
                callback();
            }
            automaticWelcomeMessage();
        });
        reviseStatusInterval = setInterval(reviseStatusBar, 2000);
        window.resLoopInterval = setInterval(serverResourceLoop, 1000);
    });
}

window.addEventListener('resize', () => {
    if (mobileImageFullView?.modal?.style?.display === 'flex') {
        mobileImageFullView.resizeCanvas();
    }
});

setTimeout(genpageLoad, 1);
