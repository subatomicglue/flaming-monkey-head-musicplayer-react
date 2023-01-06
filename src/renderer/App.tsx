
import { contextBridge, MouseInputEvent, clipboard } from 'electron';
import { MouseEventHandler, SyntheticEvent, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Link, NavLink, Outlet, MemoryRouter as Router, Routes, Route, useSearchParams, useParams,
  useNavigate,
  useLocation, Navigate, createSearchParams } from 'react-router-dom'; // https://github.com/remix-run/react-router/blob/main/docs/getting-started/tutorial.md
import {Mutex, Semaphore, withTimeout} from 'async-mutex';
import './App.css';
import 'material-icons';
//import 'bootstrap';
import icon from '/assets/icon.svg';
import defaultpng from "/assets/default.png"; // auto copy the default icon over to the build folder
const xhr = require('xhrjs/xhr').init( XMLHttpRequest ).xhr;
const xhrAuth = require('xhrjs/xhr').init( XMLHttpRequest ).xhrAuth;
//import xhr from "xhrjs/xhr.js";

let VERBOSE = false;
let localStorage_Lock = new Mutex();
let dataFetch_Lock = new Mutex();
let last_browse_path = "/";

let init_local_storage = false;
async function saveBrowserLocalStorage() {
  await localStorage_Lock.runExclusive( async () => {
    await window.electron.invoke( "saveBrowserLocalStorage" );
  });
}
async function loadBrowserLocalStorage() {
  if (init_local_storage) return;
  await localStorage_Lock.runExclusive( async () => {
    if (init_local_storage) return;
    await window.electron.invoke( "loadBrowserLocalStorage" );
    init_local_storage = true;
  })
}

function encodeMediaPath( path ) {
  return path.replace( /\?/g, "%3F" )
}
function decodeMediaPath( path ) {
  return path.replace( /%3F/g, "?" )
}

// global keyboard handler.
function onKeyDown_GlobalHandler( e:KeyboardEvent ) {
  if (e.repeat) return;
  console.log( "[onKeyDown]", e.code, "meta", e.metaKey, "alt", e.altKey, "ctrl", e.ctrlKey );
  if (e.code=="Space") {
    console.log( `Toggle play/pause (playing: ${player.isPlaying()}` )
    player.isPlaying() ? player.track_pause() : player.track_play()
    e.preventDefault();
  }
  if (e.code=="Escape") {// || (e.code=="KeyQ" && (e.metaKey || e.ctrlKey)) || (e.code=="KeyW" && (e.metaKey || e.ctrlKey)) ) {
    window.electron.invoke( "app", "quit" );
    e.preventDefault();
  }
  if (e.code=="ArrowRight") {
    if (player.isPlaying()) {
      player.audio.currentTime = Math.min( player.audio.currentTime + 10, player.audio.duration ); // 10 seconds
      player.updateTrackTime();
      e.preventDefault();
    }
  }
  if (e.code=="ArrowLeft") {
    if (player.isPlaying()) {
      player.audio.currentTime = Math.min( player.audio.currentTime - 10, player.audio.duration ); // 10 seconds
      player.updateTrackTime();
      e.preventDefault();
    }
  }
  if (e.code=="ArrowUp") {
    if (player.isPlaying()) {
      player.track_prev();
      e.preventDefault();
    }
  }
  if (e.code=="ArrowDown") {
    if (player.isPlaying()) {
      player.track_next();
      e.preventDefault();
    }
  }
}

async function waitForValue( value_func, should_be, timeout_sec = 5 ) {
  return new Promise( (rs, rj) => {
    if (value_func() == should_be) return rs();
    let startTime = new Date();
    let handle = setInterval( () => {
      let endTime = new Date();
      var timeDiff = (endTime - startTime)/1000;
      if (timeout_sec < timeDiff && timeout_sec != -1) {
        console.log( "timeout! v:", v )
        clearInterval( handle );
        return rs();
      } else if (value_func() == should_be) {
        console.log( "it's finally true! timeout_sec:", timeout_sec )
        clearInterval( handle );
        return rs();
      } else {
        console.log( `waiting for '${value_func()}' to be '${should_be}'...1` )
      }
    }, 1)
  })
}

function protocolFilter( i ) {
  // auto copy the default icon over to the build folder
  // if (i.match( /file:\/\/\/?assets\/default.png$/ )) {
  //   console.log( "DEFAULT ASSET\n" );
  //   return defaultpng;
  // }

  // console.log( "image", i.replace(/^file:/,"res:") );
  // if (i.match(/\.png$/)) {
  //   async function fetch( url ) {
  //     let image = await xhr( "GET", url,  {'Content-Type': 'application/octet-stream+base64' } );
  //     console.log( image.body )
  //   }
  //   fetch( i.replace(/^file:/,"res:") );
  // }

  return i ? i.replace(/^file:/,"res:") : defaultpng;
}

// deeply clone an object hierarchy
function deepClone( obj ) {
  if (obj == undefined) return undefined;
  return JSON.parse( JSON.stringify( obj ) );
}

//////////////////
// AUDIO PLAYER
//////////////////

class Player {
  progress_manipulating:boolean = false;
  playing:any = { i: 0, listing: [], track: undefined };//{ title: "1", artist: "2", album: "3", path: "4", abs_path: "bok", image: defaultpng } };
  currentTime:string = "--:--:--";
  progressamt:string = "0%";
  mode:number = 0;
  timer:any;
  audio:typeof Audio;
  onTrackChange = (track, i, listing) => {};
  onPlayerTransportChange = (state) => {};
  onModeChange = (mode) => {};
  onNavigate = (url) => {};
  onProgressChange = (progress_amt, progress_time) => {};
  onListingChange = (l) => {};

  constructor() {
    this.audio = window.audio; // persist across webpack HMR (hot module reload)
    let playing = localStorage.getItem( "playing" ); // persist across webpack HMR (hot module reload) and app reload
    this.playing = playing ? JSON.parse( playing ) : this.playing;
    console.log(this.playing )

    window.addEventListener('online', () => {
      console.log( "[Player] online" )
    })
    window.addEventListener('offline', () => {
      console.log( "[Player] offline" )
      this.track_stop();
    })
  }

  release() {
    if (this.audio) delete this.audio;
  }

  resendState() {
    console.log( "[Player] resending state..." );
    this.onTrackChange && this.onTrackChange(this.playing.track, this.playing.i, this.playing.listing);
    this.onPlayerTransportChange && this.onPlayerTransportChange( this.isPlaying() ? "playing" : "paused" );
    this.onModeChange && this.onModeChange( this.mode );
    this.onProgressChange && this.onProgressChange( this.progressamt, this.currentTime );
    this.onListingChange && this.onListingChange( this.playing.listing );
  }

  isPlaying() { return this.audio && !this.audio.paused; }

  modes = [
    "play_all", "play_1", "repeat_1", "repeat_all",
  ];
  modes_repeaticon = [
    "play_black_24dp", "play_one_black_24dp", "repeat_one_black_24dp", "repeat_black_24dp",
  ];

  // user has moved the mouse in the progress bar...
  progressMove( e ){
    if (this.progress_manipulating) {
      // react gives us a cross browser SyntheticEvent (e.nativeEvent is present); browser gives us MouseEvent...
      // https://reactjs.org/docs/events.html
      let amt = e.nativeEvent ? e.clientX / e.currentTarget.clientWidth : e.x / e.srcElement.clientWidth;
      this.audio.currentTime = this.audio.duration * amt;
      this.updateTrackTime();
      //console.log( "progress interaction", amt )
    }
  }
  // user has clicked on the progress bar
  progressStart(e) { this.progress_manipulating = true; this.progressMove( e ); /*console.log( "progress start" )*/ }
  progressEnd(e) { this.progress_manipulating = false; this.progressMove( e ); /*console.log( "progress end" )*/ }
  track_play() {
    if (!this.playing || !this.playing.track || this.isPlaying()) return;

    // play a stopped track
    if (!this.audio) {
      console.log( "play stopped", this.playing.index );
      this.playAudio( this.playing.track, this.playing.index, this.playing.listing );
      return;
    }

    // unpause existing track
    this.audio.volume = 1;
    this.audio.play();
    this.updateTrackTime();

    // timer = setInterval( () => {//
    //   currentTime = HomeComponent.formatTime( audio.currentTime );
    // }, 1000 );
  }
  track_pause() {
    if (this.playing && this.playing.track && !this.isPlaying()) return;

    this.audio.pause();

    // clearInterval( timer );
    // timer = undefined;
  }
  track_inc( inc ) {
    if (this.audio && inc < 0 && 2 <= this.audio.currentTime) {
      this.audio.currentTime = 0;
      console.log( "1" );
    } else {
      if (this.audio) this.audio.volume = 0;

      let i = this.playing.index;
      let next_i = this.track_search_next( i, inc, this.modes[this.mode] == "repeat_all" );
      if (0 <= next_i && next_i <= (this.playing.listing.length - 1)) {
        //console.log( i, next_i, (playing.listing.length - 1), playing.listing[next_i], playing.listing )
        this.playAudio( this.playing.listing[next_i], next_i, this.playing.listing )
        console.log( "[Player] track_inc:playAudio", next_i );
      }
      else {
        // allow index to go off the end of the dir listing...
        this.playing.index = inc < 0 ? -1 : this.playing.listing.length;
        this.killAudio();
        console.log( "[Player] track_inc:killAudio", this.playing.index );
      }
    }
  }
  track_next() { this.track_inc( 1 ); }
  track_prev() { this.track_inc( -1 ); }
  track_stop() {
    this.killAudio();
  }
  track_search_next( i, dir=1, wrap = false ) {
    let next_i = wrap ? (i + dir) % (this.playing.listing.length - 1) : i + dir;
    while (0 <= next_i && next_i <= (this.playing.listing.length - 1)) {
      if (this.playing.listing[next_i].type == "file" && this.playing.listing[next_i].ext.match( /(m4a|mp3|aac|wav)/ )) {
        return next_i;
      }
      next_i += dir;
    }
    return -1;
  }

  scrollTo( elementID, delay_msec = 0 ) {
    setTimeout( () => {
      if (document.getElementById(elementID))
        document.getElementById(elementID).scrollIntoView({
          behavior: "smooth",
          //block: "start", // the top of the element will be aligned to the top of the visible area of the scrollable ancestor
          //block: "end",     // the bottom of the element will be aligned to the bottom of the visible area of the scrollable ancestor
          block: "center",
          inline: "nearest"
        });
    }, delay_msec );
  }
  formatTime(seconds: number): string {
    let minutes: any = Math.floor(seconds / 60);
    let secs: any = Math.floor(seconds % 60);
    if (minutes < 10) {
      minutes = '0' + minutes;
    }
    if (secs < 10) {
      secs = '0' + secs;
    }
    return minutes +  ':' + secs;
  }
  updateTrackTime() {
    this.currentTime = this.audio ? this.formatTime( this.audio.currentTime ) : "--:--"
    this.progressamt = this.audio ? `${this.audio.currentTime == 0 ? 0 : (this.audio.currentTime / this.audio.duration) * 100}%` : '0%';
    this.onProgressChange( this.progressamt, this.currentTime );
    //console.log( "progress:", progressamt, "time:", currentTime );
  }
  toggleMode() {
    this.mode = (this.mode + 1) % (this.modes.length)
    this.onModeChange( this.mode );
  }
  async playAudio( f, i, listing ) {
    this.killAudio();
    this.playing.index = i;
    this.playing.track = deepClone( f );
    this.playing.listing = deepClone( listing );
    console.log( "[Player] playAudio", i );

    localStorage.setItem( "playing", JSON.stringify( this.playing ) ); // persist across webpack HMR (hot module reload) and app reload

    //console.log( "xhr", f.content );
    //let data = await xhr( "GET", "res://" + f.content,  {}/*{'Content-Type': 'application/octet-stream' }*/ );
    //data = data.body
    //let data = await window.electron.invoke( 'readFileSync', f.content );
    //console.log( data )
    //return;

    this.audio = new Audio();
    window.audio = this.audio; // persist across webpack HMR (hot module reload)

    // auto next track, when track ends:
    this.audio.onended = (event) => {
      if (this.audio == undefined) return;

      this.audio.volume = 0;

      let i = this.playing.index;
      let next_i = i;
      console.log( "[Player] Track Ended (processing repeat mode): ", this.modes[this.mode] );
      switch (this.modes[this.mode]) {
        case "play_1": next_i = i; break;
        case "repeat_1": next_i = i; break;
        case "repeat_all": next_i = this.track_search_next( i, 1, true ); break;
        case "play_all": next_i = this.track_search_next( i, 1, false ); break;
      }
      if (this.modes[this.mode] != "play_1" && (0 <= next_i && next_i < this.playing.listing.length)) {
        this.playAudio( this.playing.listing[next_i], next_i, this.playing.listing )
        //this.scrollTo( "item" + next_i );
      } else {
        this.progressamt = "0%"
        this.currentTime = "--:--"
        setTimeout( () => { this.track_stop() }, 1000 );
      }
    }

    // update the progress time display
    this.audio.ontimeupdate = (event) => {
      this.updateTrackTime();
    };

    this.audio.onpause = () => { this.onPlayerTransportChange( "paused" ); }
    this.audio.onplay = () => { this.onPlayerTransportChange( "playing" ); }
    this.audio.oncanplay = () => {
      this.track_play();
      this.scrollTo( "item" + i )
      console.log( "[Player] play", i, f, listing )
      this.onTrackChange( f, i, listing );
    }

    // ramp the audio to silence before it ends...
    let volume_ramp_granularity = 0.01;
    let volume_ramp_time = 0.12;
    if (this.timer) clearInterval( this.timer );
    this.timer = setInterval( () => {
      if (this.audio && this.audio.duration < (this.audio.currentTime + volume_ramp_time)) {
        this.audio.volume = 0;
      }
    }, volume_ramp_granularity * 1000 );

    //this.audio.src = data;
    this.audio.src = protocolFilter( f.content );
    this.audio.load();
  }
  killAudio() {
    if (!this.audio) return;

    this.audio.src = ""; // clear whatever's loaded
    this.audio.load();   // load the nothing

    //this.audio.pause();  // fails when server is slow and still loading, so that play still hasn't happened yet (error: pause while starting play or something)
    //this.audio.currentTime = 0;

    clearInterval( this.timer );
    this.timer = undefined;

    delete this.audio;
  }

  click( f, i, listing, url_prefix, url_after_play = undefined ) {
    if (f.type == "dir") {
      console.log( "[Player] changeroute", `${url_prefix}${f.abs_path}`, f.type, i );
      this.onNavigate( `${url_prefix}${f.abs_path}` )
    } else {
      this.playAudio( f, i, listing )
      if (url_after_play) this.onNavigate( url_after_play )
    }
  }
}

// persist the "player" after HMR (hot reload).
// player's code will NOT get HMR'd!!!
// because:
// - we do not recreate it here
// - it stays allocated in the DOM window
// - which preserves what's playing
// TODO:  we can improve this by saving player state, delete, new, restore state.   going to need something like:
// - (() => { delete window.player; window.player = new Player(); return window.player })()
// - BUT... it'll need to teardown
let player = window.player ? window.player : window.player = new Player();


/////////////////////////
// REACT COMPONENTS
/////////////////////////

// component:
const MediaList =  (props:any) => {
  //let params = useParams();
  let path = props.path;
  let listing = props.listing;
  let player_state = props.player_state;
  let track = props.track;
  let click_play = props.click_play;
  // console.log( JSON.stringify( listing, null, 1 ) );
  return (listing ? listing : []).map( (f:any, i:number) => (
    <span key={"item" + i}>
      <div className="fade-in listitem" id={"item" + i} onClick={() => { f.path == '..' ? click_play( { abs_path: path + '/..', type: 'dir' }, i, listing ) : click_play( f, i, listing ) }}>

        {f.path != '..' ?
          <img className="icon" src={protocolFilter(f.image)}></img>
        :
          <span className="material-icons">arrow_back_ios</span>
        }

        <div className="text">
          <div className={ `textline ${f.type != 'dir' ? 'textline-song' : ''}` }>
            {(player_state == "playing" && track && track.resource == f.resource) ? <span className="material-icons-outlined" style={{verticalAlign: "middle", marginLeft: "-8px"}}>play_arrow</span> : ""}
            {f.title ? f.title : f.path + (f.type == "dir" ? "/" : "") }
          </div>
          {(f.path != '..') &&
            <div className="textline">{f.album ? "" + f.album : ""}
              {(f.runningtime && f.runningtime != '') &&
                <span className="duration">- {f.runningtime ? f.runningtime : ""}</span>}
            </div>}
        </div>
      </div>
    </span>
  ))
}

// component
const MediaFooter = (props:any) => {
  if (!props) return <div></div>
  //let params = useParams();
  let track = props.track ? props.track : { title: "", path: "", artist: "", album: "", image: defaultpng };
  let player_state = props.player_state;
  let mode = props.mode;
  let progressamt = props.progressamt;
  let [fullscreen_player, setFullScreenPlayer] = useState( JSON.parse( localStorage.getItem( "fullscreen_player" ) || "false" ) );  localStorage.setItem( "fullscreen_player", JSON.stringify( fullscreen_player ) );

  let foot_mode = <span>
    <div className="footer" style={{}}>
      <div className="footer-left" style={{}}>
        <div className="footer-flexcell">
          <div className="" style={{ textAlign: "center", width: "60px" }}>
            <img className="" style={{ width: "40px", height: "40px" }} src={protocolFilter( track.image )}></img>
          </div>
          <div className="player-text-group">
            <div className="player-text"><strong>{track.title ? track.title : track.path}</strong></div>
            <div className="player-text">{track.artist} - {track.album}</div>
          </div>
        </div>
      </div>
      <div className="footer-center" style={{height:"60px", whiteSpace: "nowrap", verticalAlign: "middle", textAlign: "center", "overflow": "auto"}}>
        <div className="footer-flexcell">
          <div onClick={() => player.track_prev()} className="material-icons">skip_previous</div>{player_state == "playing" &&<div onClick={() => player.track_pause()} className="material-icons">pause</div>}
            {player_state == "paused" &&
              <div onClick={() => player.track_play()} className="material-icons-outlined">play_arrow</div>}
            <div onClick={() => player.track_next()} className="material-icons">skip_next</div><div onClick={() => player.track_stop()} className="material-icons">close</div>
        </div>
      </div>
      <div className="footer-right" style={{ minWidth: 0, height: "60px" }}>
        <div className="footer-flexcell">
          <div className="text-center w-100">{player.currentTime} <img onClick={() => player.toggleMode()} className="svg-filter-white" src={protocolFilter( `file://assets/${player.modes_repeaticon[mode]}.svg` )}></img></div>
        </div>
      </div>
    </div>
    <div id="progress-bar" className="progress-bar" onMouseMove={(e) => player.progressMove(e)} onMouseDown={ (e)=> player.progressStart(e)} onMouseUp={ (e) => player.progressEnd(e) }><div id="progress-amt" className="progress-amt" style={{ 'width': progressamt }}>&nbsp;</div></div>
  </span>

  return foot_mode
}

function convertUrlToMediaPath( url, root = "browse" ) {
  console.log( url );
  let path = decodeMediaPath( url ).replace( new RegExp( `^/${root}` ), "" );
  path = path == "" ? "/" : path;
  return path
}

// component
const Header = (props) => {
  let navigate = useNavigate();
  const folderimage = props.folderimage
  return <span>
    <img className="albumart" src={protocolFilter( folderimage )}></img>
    <span className="button material-icons" onClick={ () => { navigate(-1) } }>arrow_back</span>
    <span className="button material-icons" onClick={ () => { navigate(1) } }>arrow_forward</span>
    <span className="button material-icons" onClick={ () => { window.location.reload(true) } }>refresh</span>
    |
    <span className="button material-icons" onClick={ () => { navigate( encodeMediaPath( "/browse" + last_browse_path ) ) } }>folder</span>
    <span className="button material-icons" onClick={ () => { navigate( encodeMediaPath( "/queue" ) ) } }>playlist_add</span>
    <span className="button material-icons" onClick={ () => { navigate( encodeMediaPath( "/player" ) ) } }>ondemand_video</span>
  </span>
}

// component:
const Loading = () => {
  return <div className="fade-in" style={{ position: "fixed", left: "0px", top: "0px", width: "100%", height: "100vh" , display: "flex", justifyContent: "center", alignItems: "center" }}>... loading ...</div>
}

let init_once = true;
async function init( navigate_func = (url:string) => {}, location ) {
  if (init_once) {
    await loadBrowserLocalStorage();
    let url = localStorage.getItem( "lastURL" );
    if (url) {
        console.log( `[init] RESTORING URL: "${url}"` )
        navigate_func( url );
    }
  } else {
    console.log( `[init] SAVE URL: "${location.pathname}"` );
    localStorage.setItem( "lastURL", location.pathname );
  }
  init_once = false;
}

// page:
const MediaPlayer = (props:any) => {
  if (!props) return <div></div>
  //let params = useParams();
  let navigate = useNavigate();
  let location = useLocation();
  const onKeyDown = useCallback( (e) => {
    if (e.repeat) return;
    // intercept escape to close the player and return to whence we came:
    if (e.code=="Escape") {
      navigate(-1);
      e.preventDefault();
      return;
    }
    onKeyDown_GlobalHandler( e )
  }, [] )

  // player state:
  let [progressamt, setProgressAmt] = useState(player.progressamt);
  let [progresstime, setProgressTime] = useState(player.currentTime);
  let [track, setTrack] = useState(player.playing.track);
  let [mode, setMode] = useState(player.mode);
  let [player_state, setPlayerTransport] = useState("paused");

  // only called on mount/unmount
  useEffect(() => {
    console.log('[MediaPlayer] init......');
    init( navigate, location ).then( () => {
      player.onNavigate = (url) => { console.log( "[MediaPlayer] onNavigate", `${url}` ); navigate( encodeMediaPath( `${url}` ) ); }
      player.onProgressChange = (amt, time) => { setProgressAmt( amt ); setProgressTime( time ); };
      player.onTrackChange = (t, i, l) => { setTrack( t ) };
      player.onPlayerTransportChange = (state) => { setPlayerTransport(state) };
      player.onModeChange = (mode) => { setMode( mode ) };
      player.resendState();
      window.addEventListener("keydown", onKeyDown );
      console.log('[MediaPlayer] MOUNT');
    })
    return () => {
      window.removeEventListener("keydown", onKeyDown );
      console.log('[MediaPlayer] UNMOUNT');
      saveBrowserLocalStorage();
    }
  }, [])  // [] -> only called on mount/unmount (once ever) .

  // called every time
  useEffect( () => {
      init( navigate, location ).then( async () => {
        console.log( `[MediaPlayer] URL: "${location.pathname}${location.search}"` );
        //console.log( `[MediaPlayer] dir( "${path}" )` );
      });
      return () => { /*cleanup*/}
    },
    [location.pathname], // [args, ...] rerun when any of these change.
  );

  let full_mode = <span>
    <div className="footer2" style={{}}>
      <div className="player-back-button"><span className="material-icons" onClick={() => navigate(-1)}>arrow_back</span></div>
      <div></div>
      <img className="" style={{ width: "auto", height: "66vh" }} src={protocolFilter( track ? track.image : defaultpng )}></img>
      <div className="">
        <div className=""><strong>{track ? (track.title ? track.title : track.path) : "< no track queued yet >"}</strong></div>
        <div className="">{track ? track.artist : "< artist >"} - {track ? track.album : "< album >"}</div>
      </div>
      <div className="footer-center" style={{height:"60px", whiteSpace: "nowrap", verticalAlign: "middle", textAlign: "center", "overflow": "auto"}}>
        <div className="footer-flexcell">
          <div onClick={() => player.track_prev()} className="material-icons">skip_previous</div>{player_state == "playing" &&<div onClick={() => player.track_pause()} className="material-icons">pause</div>}
            {player_state == "paused" &&
              <div onClick={() => player.track_play()} className="material-icons-outlined">play_arrow</div>}
            <div onClick={() => player.track_next()} className="material-icons">skip_next</div><div onClick={() => player.track_stop()} className="material-icons">close</div>
        </div>
      </div>
      <div className="text-center w-100">{progresstime} <img onClick={() => player.toggleMode()} className="svg-filter-white" src={protocolFilter( `res://assets/${player.modes_repeaticon[mode]}.svg` )}></img></div>
      <div id="progress-bar" className="progress-bar" onMouseMove={(e) => player.progressMove(e)} onMouseDown={ (e)=> player.progressStart(e)} onMouseUp={ (e) => player.progressEnd(e) }><div id="progress-amt" className="progress-amt" style={{ 'width': progressamt }}>&nbsp;</div></div>
    </div>
  </span>
  return full_mode
}

// page:
const MediaQueue =  (props:any) => {
  let navigate = useNavigate();
  let location = useLocation();
  // let params = useParams();  // for parsing id and id2 from the router "/browse/:id/:id2/", etc...
  let path = convertUrlToMediaPath( location.pathname, "queue" );
  const onKeyDown = useCallback( (e) => onKeyDown_GlobalHandler( e ), [] )

  // player state:
  let [listing, setListing] = useState( [] );
  let [progressamt, setProgressAmt] = useState(player.progressamt);
  let [progresstime, setProgressTime] = useState(player.currentTime);
  let [track, setTrack] = useState(player.playing.track);
  let [mode, setMode] = useState(player.mode);
  let [player_state, setPlayerTransport] = useState("paused");
  let [folderimage, setFolderImage] = useState(icon);
  let [loading, setLoading] = useState(false);

  // only called on mount/unmount
  useEffect(() => {
    console.log('[MediaQueue] init......');
    init( navigate, location ).then( () => {
      player.onNavigate = (url) => { console.log( "[MediaBrowser] onNavigate", `${url}` ); navigate( encodeMediaPath( `${url}` ) ); }
      player.onProgressChange = (amt, time) => { setProgressAmt( amt ); setProgressTime( time ); };
      player.onTrackChange = (t, i, l) => { setTrack( t ) };
      player.onPlayerTransportChange = (state) => { setPlayerTransport(state) };   /* init */ setPlayerTransport( player.isPlaying() ? "playing" : "paused" )
      player.onModeChange = (mode) => { setMode( mode ) };
      player.resendState();
      window.addEventListener("keydown", onKeyDown );
      console.log('[MediaQueue] MOUNT');
      console.log('====================MOUNT======================');
    })
    return () => {
      window.removeEventListener("keydown", onKeyDown );
      console.log('[MediaQueue] UNMOUNT');
      saveBrowserLocalStorage();
    }
  }, [])  // [] -> only called on mount/unmount (once ever)

  // called every time
  useEffect( () => {
      init( navigate, location ).then( async () => {
        console.log( `[MediaQueue] URL: "${location.pathname}${location.search}"` );
        console.log( `[MediaQueue] dir( "${path}" )` );
      });
      return () => { /*cleanup*/}
    },
    [location.pathname], // [args, ...] rerun when any of these change.
  );

  // useLayoutEffect( () => {
  //     return () => {/*cleanup*/}
  //   },
  //   [mode, audio, playing, playing.track, progressamt, currentTime, playing.listing, playing.i], // [args, ...] rerun when any of these change.   [] -> only on mount/unmount (once ever)
  // );


  let dom = (
    <div className="listing" onMouseUp={() => { player.progress_manipulating = false }} >
    <Header path={path} root="" folderimage={folderimage}></Header>
    <span>
    <div onClick={() => navigate(`/queue${path}`)}>queue:{path}</div>
    <MediaList path={path} listing={player.playing.listing} player_state={player_state} track={track} click_play={ (...args:any) => { player.click( ...args, "/queue", "/player" ); } }></MediaList>
    </span>
    {track && <MediaFooter track={track} player_state={player_state} mode={mode} progressamt={progressamt} progreestime={progresstime}></MediaFooter>}
    </div>
  );

  return dom;
};

// component:
const MediaPath =  (props:any) => {
  let navigate = useNavigate();
  let path = props.path;
  let path_prefix = props.path_prefix;
  let [clipboard, setClipboard] = useState( "" );

  const onKeyDown = useCallback( ( e:KeyboardEvent ) => {
    if (e.repeat) return;
    if (e.code=="KeyV" && (e.metaKey || e.ctrlKey)) {
      console.log( "Paste", clipboard );
      if (clipboard != "") {
        navigate(`/${path_prefix}${clipboard}`)
      }
      e.preventDefault();
    }
    if (e.code=="KeyC" && (e.metaKey || e.ctrlKey)) {
      clipboard=path;
      console.log( "Copy", clipboard );
      e.preventDefault();
    }
  }, []);

  // only called on mount/unmount
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown );
    console.log('[MediaPath] MOUNT');
    return () => {
      window.removeEventListener("keydown", onKeyDown );
      console.log('[MediaPath] UNMOUNT');
    }
  }, [])  // [] -> only called on mount/unmount (once ever)

  //given ["1", "2", "3, "4], returns ["1", "1/2", "1/2/3", "1/2/3/4" ]
  const cumulativePathConcat = (sum => value => sum += "/" + value)("");
  return <div>
    <span id="path" style={{display: "none"}}>{path}</span>
    <span onClick={() => navigate(`/${path_prefix}/`)}>media:/</span>{path.split("/").filter( r => r != "" ).map( cumulativePathConcat ).map( r => <span onClick={() => navigate(`/${path_prefix}${r}`)}>{`${r.replace(/^.*\//,"")}/`}</span> )}
    <span className="button-tiny material-icons" onClick={ () => {window.electron.invoke( "clipboard", "writeText", path )}}>content_copy</span>
    <span className="button-tiny material-icons" onClick={ async () => navigate( encodeMediaPath( `/${path_prefix}${await window.electron.invoke( "clipboard", "readText" )}` ) )}>content_paste</span>
  </div>
}

// page:
const MediaBrowser =  (props:any) => {
  let navigate = useNavigate();
  let location = useLocation();
  // let params = useParams();  // for parsing id and id2 from the router "/browse/:id/:id2/", etc...
  let path = convertUrlToMediaPath( location.pathname, "browse" );
  last_browse_path = path;
  const onKeyDown = useCallback( (e) => onKeyDown_GlobalHandler( e ), [] )

  // the heavy hand
  //let [__rerender, __setRerender] = useState(0);      function render() { __setRerender(__rerender+1); }

  // player state:
  let [listing, setListing] = useState( [] );
  let [progressamt, setProgressAmt] = useState(player.progressamt);
  let [progresstime, setProgressTime] = useState(player.currentTime);
  let [track, setTrack] = useState(player.playing.track);
  let [mode, setMode] = useState(player.mode);
  let [player_state, setPlayerTransport] = useState("paused");
  let [folderimage, setFolderImage] = useState(icon);
  let [loading, setLoading] = useState(false);

  // only called on mount/unmount
  useEffect(() => {
    init( navigate, location ).then( () => {
      console.log('[MediaBrowser] init......');
      player.onNavigate = (url) => { console.log( "[MediaBrowser] onNavigate", `${url}` ); navigate( encodeMediaPath( `${url}` ) ); }
      player.onProgressChange = (amt, time) => { setProgressAmt( amt ); setProgressTime( time ); };
      player.onTrackChange = (t, i, l) => { console.log( "[MediaBrowser] setTrack" ); setTrack( t ) };
      player.onPlayerTransportChange = (state) => { console.log( "[MediaBrowser] setTrack", state ); setPlayerTransport(state); };
      player.onModeChange = (mode) => { console.log( "[MediaBrowser] setMode", mode ); setMode( mode ) };
      player.resendState();
      window.addEventListener("keydown", onKeyDown );
      console.log('[MediaBrowser] MOUNT');
    })
    return () => {
      window.removeEventListener("keydown", onKeyDown );
      console.log('[MediaBrowser] UNMOUNT');
      saveBrowserLocalStorage();
    }
  }, [])  // [] -> only called on mount/unmount (once ever)

  // called every time
  useEffect( () => {
      async function doAsyncStuff() {
        dataFetch_Lock.runExclusive( async () => {
          setLoading( true );

          // pull a new browse listing
          console.log( `[MediaBrowser] URL: "${path}${location.search}"` );
          console.log( `[MediaBrowser] dir( "${path}" )` );
          // console.log( "save: lastURL", localStorage.getItem( "lastURL" ) )
          let l = await window.electron.invoke( "mediafs", "dir", path, undefined, false );
          let curdir = l.filter( r => r.path == "." );
          l = l.filter( r => r.path != "." && r.path != ".." && !r.path.match( /^\./ ) );
          setListing( l );
          setFolderImage( curdir.length > 0 && curdir[0].image ? curdir[0].image.match( /default/ ) ? icon : curdir[0].image : icon )
          //console.log( JSON.stringify( l, null, 1 ) );

          setLoading( false );
          await saveBrowserLocalStorage(); // periodically commit any changes to disk...
        })
      }
      init( navigate, location ).then( async () => await doAsyncStuff() );
      return () => { /*cleanup*/}
    },
    [location.pathname], // [args, ...] rerun when any of these change
  );

  // useLayoutEffect( () => {
  //     return () => {/*cleanup*/}
  //   },
  //   [mode, audio, playing, playing.track, progressamt, currentTime, playing.listing, playing.i], // [args, ...] rerun when any of these change.   [] -> only on mount/unmount (once ever)
  // );

  let dom2 = (
    <div className="listing" onMouseUp={() => { player.progress_manipulating = false }} >
      <Header path={path} root="" folderimage={folderimage}></Header>
      {loading && <Loading></Loading>}
      {!loading &&
        <span>
          <MediaPath path={path} path_prefix="browse"></MediaPath>
          <MediaList path={path} listing={listing} player_state={player_state} track={track} click_play={ (...args:any) => { player.click( ...args, "/browse", "/player" ); } }></MediaList>
        </span>
      }
      {track && <MediaFooter track={track} player_state={player_state} mode={mode} progressamt={progressamt} progresstime={progresstime}></MediaFooter>}
    </div>
  );

  return dom2;
};

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/queue" element={<MediaQueue />}></Route>
        <Route path="/player" element={<MediaPlayer />}></Route>
        <Route path="/browse/*" element={<MediaBrowser />}></Route>
        <Route path="*" element={ <Navigate to="/browse" /> }></Route>
      </Routes>
    </Router>
  );
}
