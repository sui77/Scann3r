const socketIo = require('socket.io');
const Scan = require('../lib/Scan.js');
const ProxyClient = require('./ProxyClient.js');
const fs = require('fs');
const log = require('bunyan').createLogger({name: 'WebSocket'});
const rimraf = require('rimraf');

class WebSocket {


    constructor(registry) {
        this.config = registry.get('config');
        this.registry = registry;
        this.io = socketIo(registry.get('webServer').getServer(), {path: '/ws'});

        this.initHandler();
        this.registerEvents();

        this.sliderAction = {
            rotor: (type, value) => {
                if (type == 'slide') { return; }
                this.registry.get('rotor').turnTo(value);
            },
            turntable: (type, value) => {
                if (type == 'slide') { return; }
                this.registry.get('turntable').turnTo(value);
            },

            shutter: (type, value) => {
                this.registry.get('camera').set('shutter', value);
            },
            brightness: (type, value) => {
                this.registry.get('camera').set('brightness', value);
            },
            contrast: (type, value) => {
                this.registry.get('camera').set('contrast', value);
            },
            saturation: (type, value) => {
                this.registry.get('camera').set('saturation', value);
            },

            light: (type, value) => {
                this.registry.get('config').set('light.value', value);
                this.registry.get('gpio').light1.write(((value == 1 || value == 2) * 1));
                this.registry.get('gpio').light2.write((value == 2) * 1);
            },
            imagesPerRevision: (type, value) => {
                if (type == 'slide') { return; }
                this.registry.get('config').set('imagesPerRevision.value', value);
            },
            rotorAnglesPerScan: (type, value) => {
                if (type == 'slide') { return; }
                this.registry.get('config').set('rotorAnglesPerScan.value', value);
            },
            rotorAngleRangeToScan: (type, value) => {
                if (type == 'slide') { return; }
                this.registry.get('config').set('rotorAngleRangeToScan.values', value);
            },
        };


    }

    registerEvents() {
        this.registry.get('rotor').onTurn = (displayValue) => {
            this.io.emit('setSliderValue', 'rotor', displayValue);
            this.registry.get('config').set('rotor.value', displayValue);
        }

        this.registry.get('turntable').onTurn = (displayValue) => {
            this.io.emit('setSliderValue', 'turntable', displayValue);
            this.registry.get('config').set('turntable.value', displayValue);
        }

        this.registry.get('camera').onPreviewDone = (file) => {
            this.io.emit('updateCameraPreview', file);
        }
    }


    initHandler() {
        this.io.on('connection', async (socket) => {

            log.info(`Client connected from ${socket.handshake.address}`);
            if (this.registry.get('scanning')) {
                socket.emit('disableControls');
            }

            this.registry.get('camera').startPreview();

            for (let slider in this.sliderAction) {
                let options = this.config.get(slider);
                socket.emit('initSlider', slider, options);
            }
            socket.emit('info', 'info-version', this.config.get('version'));
            socket.emit('imgArea', this.config.get('crop.values'));
            socket.emit('invert', this.config.get('rotor.invert'));

            socket.on('disconnect', () => {
                log.info(`Client disconnected from ${socket.handshake.address}`);
                if (this.io.engine.clientsCount == 0) {
                    this.registry.get('camera').stopPreview();
                }
            });

            socket.on('proxy', async (id, cb) => {
                let proxyClient = new ProxyClient(this.registry, this.config.get('misc.projectsFolder') + '/' + id + '/images.zip');
                try {
                    let pdata = await proxyClient.start();
                    cb(null, pdata);
                } catch (e) {
                    cb('Proxy connection failed', null);
                }
            });

            socket.on('imgArea', (data) => {
                this.registry.get('config').set('crop.values', data);
                this.io.emit('imgArea', data);
                console.log(data);
            });

            socket.on('getProjects', async (page, perPage, cb) => {
                let r = this.registry.get('redis');
                let projects = await r.lrange('projects', page * perPage, page * perPage + perPage);
                let result = [];
                for (let n in projects) {
                    let p = await r.hgetall('project:' + projects[n]);
                    if (p != null) {
                        result.push(p);
                    }
                }
                cb(result);
            });

            socket.on('start', async () => {
                this.registry.set('abort', false);
                this.registry.set('scanning', true);
                let scan = new Scan(this.registry, this.io);
                await scan.start();
                this.registry.set('scanning', false);
            });

            socket.on('abort', async () => {
                console.log('ABORT');
                this.registry.set('abort', true);
                this.io.emit('info', 'currentAction', 'Aborting...');
            });

            socket.on('delete', async (id, cb) => {
                if (!id.match(/^[0-9]*$/)) {
                    cb('NOPE', false);
                    return;
                }
                try {
                    let r = this.registry.get('redis');
                    // fs.rmdirSync(this.config.get('misc.projectsFolder') + '/' + id, {recursive: true});
                    rimraf.sync(this.config.get('misc.projectsFolder') + '/' + id);
                    r.del('project:' + id);
                    r.lrem('projects', 1, id);
                    cb(null, 1);
                } catch (e) {
                    cb('Could not delete project' + e.message, null);
                }
            });

            socket.on('rotorCalibrate', (steps) => {
                try {
                    this.registry.get('rotor').turnBy(steps);
                } catch (e) {
                    console.log(e);
                }
            });

            socket.on('rotorCalibrateDirection', (data) => {
                this.registry.get('rotor')._config.invert = data;
                this.registry.get('config').set('rotor.invert', data);
                this.io.emit('invert', data);
            });

            socket.on('rotorCalibrateSetHome', () => {
                this.registry.get('rotor').setHome();
            });

            socket.on('turntableCalibrateSetHome', () => {
                this.registry.get('turntable').setHome();
            });

            socket.on('slider', (type, name, value) => {
               this.io.emit('setSliderValue', name, value);
                if (typeof this.sliderAction[name] != 'undefined') {
                    this.sliderAction[name](type, value);
                } else {
                    log.error(`Unknown slider ${name}`);
                }
            });


        });

    }
}

module.exports = WebSocket;