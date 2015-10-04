var atob = require('atob');
var toFlatArray = function(arr, outBuffer){
    if(outBuffer == null){
        outBuffer = [];
    }
    for(var i = 0; i < arr.length; i++){
        if(typeof arr[i] == 'object'){
            //an array
            toFlatArray(arr[i], outBuffer)
        }else{
            //a simple element
            outBuffer.push(arr[i]);
        }
    }
    return outBuffer;
}

var makeSimpleBlock = function(data){
    var flags = 0;
    if (data.keyframe) flags |= 128;
    if (data.invisible) flags |= 8;
    if (data.lacing) flags |= (data.lacing << 1);
    if (data.discardable) flags |= 1;
    if (data.trackNum > 127) {
        throw "TrackNumber > 127 not supported";
    }
    var out = [data.trackNum | 0x80, data.timecode >> 8, data.timecode & 0xff, flags].map(function(e){
            return String.fromCharCode(e)
        }).join('') + data.frame;
    //console.log(data.frame);
    return out;
}

var makeSimpleAudioBlock = function(data){
    var flags = 0;
    if (data.keyframe) flags |= 128;
    if (data.invisible) flags |= 8;
    if (data.lacing) flags |= (data.lacing << 1);
    if (data.discardable) flags |= 1;
    if (data.trackNum > 127) {
        throw "TrackNumber > 127 not supported";
    }
    var out = [data.trackNum | 0x80, data.timecode, data.timecode, flags].map(function(e){
            return String.fromCharCode(e)
        }).join('') + data.frame;
    return out;
}

function parseWebP(riff){
    var VP8 = riff.RIFF[0].WEBP[0];

    var frame_start = VP8.indexOf('\x9d\x01\x2a'); //A VP8 keyframe starts with the 0x9d012a header
    for(var i = 0, c = []; i < 4; i++) c[i] = VP8.charCodeAt(frame_start + 3 + i);

    var width, horizontal_scale, height, vertical_scale, tmp;

    //the code below is literally copied verbatim from the bitstream spec
    tmp = (c[1] << 8) | c[0];
    width = tmp & 0x3FFF;
    horizontal_scale = tmp >> 14;
    tmp = (c[3] << 8) | c[2];
    height = tmp & 0x3FFF;
    vertical_scale = tmp >> 14;
    return {
        width: width,
        height: height,
        data: VP8,
        riff: riff
    }
}

function parseRIFF(string){
    var offset = 0;
    var chunks = {};

    while (offset < string.length) {
        var id = string.substr(offset, 4);
        chunks[id] = chunks[id] || [];
        if (id == 'RIFF' || id == 'LIST') {
            var len = parseInt(string.substr(offset + 4, 4).split('').map(function(i){
                var unpadded = i.charCodeAt(0).toString(2);
                return (new Array(8 - unpadded.length + 1)).join('0') + unpadded
            }).join(''),2);
            var data = string.substr(offset + 4 + 4, len);
            offset += 4 + 4 + len;
            chunks[id].push(parseRIFF(data));
        } else if (id == 'WEBP') {
            // Use (offset + 8) to skip past "VP8 "/"VP8L"/"VP8X" field after "WEBP"
            chunks[id].push(string.substr(offset + 8));
            offset = string.length;
        } else {
            // Unknown chunk type; push entire payload
            chunks[id].push(string.substr(offset + 4));
            offset = string.length;
        }
    }
    return chunks;
}

// here's a little utility function that acts as a utility for other functions
// basically, the only purpose is for encoding "Duration", which is encoded as
// a double (considerably more difficult to encode than an integer)
function doubleToString(num){
    return [].slice.call(
        new Uint8Array(
            (
                new Float64Array([num]) //create a float64 array
            ).buffer) //extract the array buffer
        , 0) // convert the Uint8Array into a regular array
        .map(function(e){ //since it's a regular array, we can now use map
            return String.fromCharCode(e) // encode all the bytes individually
        })
        .reverse() //correct the byte endianness (assume it's little endian for now)
        .join('') // join the bytes in holy matrimony as a string
}

function doubleToString32(num){
    return [].slice.call(
        new Uint8Array(
            (
                new Float32Array([num]) //create a float32 array
            ).buffer) //extract the array buffer
        , 0) // convert the Uint8Array into a regular array
        .map(function(e){ //since it's a regular array, we can now use map
            return String.fromCharCode(e) // encode all the bytes individually
        })
        .reverse() //correct the byte endianness (assume it's little endian for now)
        .join('') // join the bytes in holy matrimony as a string
}

function numToBuffer(num){
    var parts = [];
    while(num > 0){
        parts.push(num & 0xff)
        num = num >> 8
    }
    return new Uint8Array(parts.reverse());
}

function numToFixedBuffer(num, size){
    var parts = new Uint8Array(size);
    for(var i = size - 1; i >= 0; i--){
        parts[i] = num & 0xff;
        num = num >> 8;
    }
    return parts;
}

function strToBuffer(str){
    // return new Blob([str]);

    var arr = new Uint8Array(str.length);
    for(var i = 0; i < str.length; i++){
        arr[i] = str.charCodeAt(i)
    }
    return arr;
    // this is slower
    // return new Uint8Array(str.split('').map(function(e){
    // 	return e.charCodeAt(0)
    // }))
}


//sorry this is ugly, and sort of hard to understand exactly why this was done
// at all really, but the reason is that there's some code below that i dont really
// feel like understanding, and this is easier than using my brain.

function bitsToBuffer(bits){
    var data = [];
    var pad = (bits.length % 8) ? (new Array(1 + 8 - (bits.length % 8))).join('0') : '';
    bits = pad + bits;
    for(var i = 0; i < bits.length; i+= 8){
        data.push(parseInt(bits.substr(i,8),2))
    }
    return new Uint8Array(data);
}
function checkFrames(frames){
    var width = frames[0].width,
        height = frames[0].height,
        duration = frames[0].duration;
    for(var i = 1; i < frames.length; i++){
        if(frames[i].width != width) throw "Frame " + (i + 1) + " has a different width";
        if(frames[i].height != height) throw "Frame " + (i + 1) + " has a different height";
        if(frames[i].duration < 0 || frames[i].duration > 0x7fff) throw "Frame " + (i + 1) + " has a weird duration (must be between 0 and 32767)";
        duration += frames[i].duration;
    }
    return {
        duration: duration,
        width: width,
        height: height
    };
}

function generateEBML(json){
    var ebml = [];
    for(var i = 0; i < json.length; i++){
        if (!('id' in json[i])){
            //already encoded blob or byteArray
            ebml.push(json[i]);
            continue;
        }

        var data = json[i].data;
        if(typeof data == 'object') data = generateEBML(data);
        if(typeof data == 'number') data = ('size' in json[i]) ? numToFixedBuffer(data, json[i].size) : bitsToBuffer(data.toString(2));
        if(typeof data == 'string') data = strToBuffer(data);

        var len = data.size || data.byteLength || data.length;
        var zeroes = Math.ceil(Math.ceil(Math.log(len)/Math.log(2))/8);
        var size_str = len.toString(2);
        var padded = (new Array((zeroes * 7 + 7 + 1) - size_str.length)).join('0') + size_str;
        var size = (new Array(zeroes)).join('0') + '1' + padded;

        //i actually dont quite understand what went on up there, so I'm not really
        //going to fix this, i'm probably just going to write some hacky thing which
        //converts that string into a buffer-esque thing

        ebml.push(numToBuffer(json[i].id));
        ebml.push(bitsToBuffer(size));
        ebml.push(data)


    }

    var buffer = toFlatArray(ebml)
    return new Uint8Array(buffer);
}

function toWebM(frames){
    var info = checkFrames(frames);

    //max duration by cluster in milliseconds
    var CLUSTER_MAX_DURATION = 30000;
    var Parser = require('t-vorbis-parser');
    var parser = new Parser("1.ogg");
    var vorbisFile = parser.parse();
    var privateData = vorbisFile.getCodecPrivateForMatriska();
    var packages = vorbisFile.getWebMSpecificAudioPackets();
    var EBML = [
        {
            "id": 0x1a45dfa3, // EBML
            "data": [
                {
                    "data": 1,
                    "id": 0x4286 // EBMLVersion
                },
                {
                    "data": 1,
                    "id": 0x42f7 // EBMLReadVersion
                },
                {
                    "data": 4,
                    "id": 0x42f2 // EBMLMaxIDLength
                },
                {
                    "data": 8,
                    "id": 0x42f3 // EBMLMaxSizeLength
                },
                {
                    "data": "webm",
                    "id": 0x4282 // DocType
                },
                {
                    "data": 2,
                    "id": 0x4287 // DocTypeVersion
                },
                {
                    "data": 2,
                    "id": 0x4285 // DocTypeReadVersion
                }
            ]
        },
        {
            "id": 0x18538067, // Segment
            "data": [
                {
                    "id": 0x1549a966, // Info
                    "data": [
                        {
                            "data": 1e6, //do things in millisecs (num of nanosecs for duration scale)
                            "id": 0x2ad7b1 // TimecodeScale
                        },
                        {
                            "data": "whammy",
                            "id": 0x4d80 // MuxingApp
                        },
                        {
                            "data": "whammy",
                            "id": 0x5741 // WritingApp
                        },
                        {
                            "data": doubleToString(Math.max(info.duration, vorbisFile.getDuration()*1000)),
                            "id": 0x4489 // Duration
                        }
                    ]
                },
                {
                    "id": 0x1654ae6b, // Tracks
                    "data": [
                        {
                            "id": 0xae, // TrackEntry
                            "data": [
                                {
                                    "data": 1,
                                    "id": 0xd7 // TrackNumber
                                },
                                {
                                    "data": 1,
                                    "id": 0x73c5 // TrackUID
                                },
                                {
                                    "data": 0,
                                    "id": 0x9c // FlagLacing
                                },
                                {
                                    "data": "und",
                                    "id": 0x22b59c // Language
                                },
                                {
                                    "data": "V_VP8",
                                    "id": 0x86 // CodecID
                                },
                                {
                                    "data": "VP8",
                                    "id": 0x258688 // CodecName
                                },
                                {
                                    "data": 1,
                                    "id": 0x83 // TrackType
                                },
                                {
                                    "id": 0xe0,  // Video
                                    "data": [
                                        {
                                            "data": info.width,
                                            "id": 0xb0 // PixelWidth
                                        },
                                        {
                                            "data": info.height,
                                            "id": 0xba // PixelHeight
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                         "id": 0xae, // TrackEntry
                         "data": [
                                {
                                    "data": 2,
                                    "id": 0xd7 // TrackNumber
                                },
                                {
                                    "data": 2,
                                    "id": 0x73c5 // TrackUID
                                },
                                {
                                    "data": 0,
                                    "id": 0x9c // FlagLacing
                                },
                                {
                                    "data": "und",
                                    "id": 0x22b59c // Language
                                },
                                {
                                    "data": "A_VORBIS",
                                    "id": 0x86 // CodecID
                                },
                                {
                                    "data": "Vorbis",
                                    "id": 0x258688 // CodecName
                                },
                                {
                                    "data" : privateData,
                                    "id" : 0x63A2 //CodecPrivate
                                },
                                {
                                    "data": 2,
                                    "id": 0x83 // TrackType
                                },
                                {
                                    "id": 0xe1,  // Audio
                                    "data": [
                                        {
                                            "data": doubleToString32(vorbisFile.infoPacket.rate),
                                            //"data" : vorbisFile.infoPacket.rate >> 14 & 0xFF,
                                            "id": 0xB5, //rate
                                            //"size" : 4
                                        },
                                        {
                                            "data": 2,
                                            //"data" : vorbisFile.infoPacket.rate >> 14 & 0xFF,
                                            "id": 0x9F, //rate
                                            //"size" : 4
                                        },
                                            ]
                                }
                            ]
                         }
                    ]
                },
                {
                    "id": 0x1c53bb6b, // Cues
                    "data": [
                        //cue insertion point
                    ]
                }

                //cluster insertion point
            ]
        }
    ];


    var segment = EBML[1];
    var cues = segment.data[2];

    //Generate clusters (max duration)
    var frameNumber = 0;
    var clusterTimecode = 0;
    while(frameNumber < frames.length){

        var cuePoint = {
            "id": 0xbb, // CuePoint
            "data": [
                {
                    "data": Math.round(clusterTimecode),
                    "id": 0xb3 // CueTime
                },
                {
                    "id": 0xb7, // CueTrackPositions
                    "data": [
                        {
                            "data": 1,
                            "id": 0xf7 // CueTrack
                        },
                        {
                            "data": 0, // to be filled in when we know it
                            "size": 8,
                            "id": 0xf1 // CueClusterPosition
                        }
                    ]
                }
            ]
        };

        cues.data.push(cuePoint);

        var clusterFrames = [];
        var clusterDuration = 0;
        do {
            clusterFrames.push(frames[frameNumber]);
            clusterDuration += frames[frameNumber].duration;
            frameNumber++;
        }while(frameNumber < frames.length && clusterDuration < CLUSTER_MAX_DURATION);
        for (var i = 0; i < packages.length; i++) {
            //clusterFrames.push(packages[i]);
        }
        var clusterCounter = 0;
        var cluster = {
            "id": 0x1f43b675, // Cluster
            "data": [
                {
                    "data": Math.round(clusterTimecode),
                    "id": 0xe7 // Timecode
                }
            ].concat(clusterFrames.map(function(webp){
                    var block = makeSimpleBlock({
                        discardable: 0,
                        frame: webp.data.slice(4),
                        invisible: 0,
                        keyframe: 1,
                        lacing: 0,
                        trackNum: 1,
                        timecode: Math.round(clusterCounter)
                    });
                    clusterCounter += webp.duration;
                    return {
                        data: block,
                        id: 0xa3
                    };
                })).concat(packages.map(function(packet) {
                    var block = makeSimpleBlock({
                        discardable: 0,
                        frame: packet.data,
                        invisible: 0,
                        keyframe: 1,
                        //lacing: 0,
                        trackNum: 2,
                        timecode: packet.timeCode + 1
                    });
                    return {
                        data: block,
                        id: 0xa3
                    }
                }))
        }

        //Add cluster to segment
        segment.data.push(cluster);
        clusterTimecode += clusterDuration;
    }

    //First pass to compute cluster positions
    var position = 0;
    for(var i = 0; i < segment.data.length; i++){
        if (i >= 3) {
            cues.data[i-3].data[1].data[1].data = position;
        }
        var data = generateEBML([segment.data[i]]);
        position += data.size || data.byteLength || data.length;
        if (i != 2) { // not cues
            //Save results to avoid having to encode everything twice
            segment.data[i] = data;
        }
    }

    return generateEBML(EBML)
};

var Video = function (quality){ // a more abstract-ish API
    this.frames = [];
    this.quality = quality || 0.8;
    this.add = function(frame, duration){
        if (!(/^data:image\/webp;base64,/ig).test(frame)) {
            throw "Input must be formatted properly as a base64 encoded DataURI of type image/webp";
        }
        this.frames.push({
            image: frame,
            duration: duration
        })
    };
    this.compile = function(){
        return new toWebM(this.frames.map(function(frame){
            var webp = parseWebP(parseRIFF(atob(frame.image.slice(23))));
            webp.duration = frame.duration;
            webp.type = 0; // audio
            return webp;
        }))
    }
    this.addAudio = function(file) {
        this.audio = file;
    }
};
var fs = require('fs');
var video = new Video();
video.addAudio("1.ogg")
var prefix = "data:image/webp;base64,"
var image1 = fs.readFileSync("1.webp");
var image2 = fs.readFileSync("2.webp");
var images = [prefix + image1.toString('base64'), prefix + image2.toString('base64')];
video.add(images[0], 10000);
//video.add(images[1], 10000);
var arrayBuffer = video.compile(true);
var buffer = new Buffer(arrayBuffer.length);
for (var i = 0; i < buffer.length; i++) {
    buffer[i] = arrayBuffer[i];
}
fs.writeFile("vid.webm", buffer, function(e) {
    if (e) {
        console.log(e)
    }
    else {
        console.log("Success")
    }
});