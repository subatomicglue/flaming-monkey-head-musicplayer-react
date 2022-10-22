
import { contextBridge, ipcRenderer, IpcRendererEvent, MouseInputEvent } from 'electron';
import { MouseEventHandler, SyntheticEvent, useEffect, useLayoutEffect, useMutationEffect, useState } from "react";
import { Link, NavLink, Outlet, MemoryRouter as Router, Routes, Route, useSearchParams, useParams,
  useNavigate,
  useLocation, Navigate, createSearchParams } from 'react-router-dom'; // https://github.com/remix-run/react-router/blob/main/docs/getting-started/tutorial.md

import './App.css';
import 'material-icons';
//import 'bootstrap';
import icon from '/assets/icon.svg';
import defaultpng from "/assets/default.png"; // auto copy the default icon over to the build folder
const xhr = require('xhrjs/xhr').init( XMLHttpRequest ).xhr;
const xhrAuth = require('xhrjs/xhr').init( XMLHttpRequest ).xhrAuth;
//import xhr from "xhrjs/xhr.js";

async function saveBrowserLocalStorage() {
  await window.electron.invoke( "saveBrowserLocalStorage" );
}
async function loadBrowserLocalStorage() {
  await window.electron.invoke( "loadBrowserLocalStorage" );
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

  return i.replace(/^file:/,"res:")
}

// deeply clone an object hierarchy
function deepClone( obj ) {
  if (obj == undefined) return undefined;
  return JSON.parse( JSON.stringify( obj ) );
}



class Player {
  progress_manipulating:boolean = false;
  playing:any = { i: 0, listing: [], track: undefined };//{ title: "1", artist: "2", album: "3", path: "4", abs_path: "bok", image: defaultpng } };
  currentTime:string = "03:45:65";
  progressamt:string = "0%";
  mode:number = 0;
  timer:any;
  audio:typeof Audio;
  onTrackChange = (track, i, listing) => {};
  onPlayerTransportChange = (state) => {};
  onModeChange = (mode) => {};
  onNavigate = (url) => {};
  onProgressChange = (progress_amt) => {};
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

  onKeyDown( e:KeyboardEvent ) {
    console.log( e.code )
    if (e.code=="Space" && !e.repeat) {
      this.isPlaying() ? this.track_pause() : this.track_play()
    }
    if (e.code=="KeyE" && !e.repeat) {

      this.track_play() //
    }
    e.preventDefault();
  }
  isPlaying() { return this.audio && !this.audio.paused; }

  modes = [
    "play_all", "play_1", "repeat_1", "repeat_all",
  ];
  modes_repeaticon = [
    "play_black_24dp", "play_one_black_24dp", "repeat_one_black_24dp", "repeat_black_24dp",
  ];

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
    this.onProgressChange( this.progressamt );
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

  click( f, i, listing ) {
    if (f.type == "dir") {
      console.log( "[Player] changeroute", f.abs_path, f.type, i );
      this.onNavigate( f.abs_path )
    } else {
      this.playAudio( f, i, listing )
    }
  }
}

let player = new Player();

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
            {(player_state == "playing" && track && track.abs_path == f.abs_path) ? <span className="material-icons-outlined" style={{verticalAlign: "middle", marginLeft: "-8px"}}>play_arrow</span> : ""}
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
          <div className="text-center w-100">{player.currentTime} <img onClick={() => player.toggleMode()} className="svg-filter-white" src={`/assets/${player.modes_repeaticon[mode]}.svg`}></img></div>
          <div onClick={() => setFullScreenPlayer(!fullscreen_player)}>^</div>
        </div>
      </div>
    </div>
    <div id="progress-bar" className="progress-bar" onMouseMove={(e) => player.progressMove(e)} onMouseDown={ (e)=> player.progressStart(e)} onMouseUp={ (e) => player.progressEnd(e) }><div id="progress-amt" className="progress-amt" style={{ 'width': progressamt }}>&nbsp;</div></div>
  </span>

  let full_mode = <span>
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
          <div className="text-center w-100">{player.currentTime} <img onClick={() => player.toggleMode()} className="svg-filter-white" src={`/assets/${player.modes_repeaticon[mode]}.svg`}></img></div>
          <div onClick={() => setFullScreenPlayer(!fullscreen_player)}>v</div>
        </div>
      </div>
    </div>
    <div id="progress-bar" className="progress-bar" onMouseMove={(e) => player.progressMove(e)} onMouseDown={ (e)=> player.progressStart(e)} onMouseUp={ (e) => player.progressEnd(e) }><div id="progress-amt" className="progress-amt" style={{ 'width': progressamt }}>&nbsp;</div></div>
  </span>
  return fullscreen_player ? full_mode : foot_mode
}

const Header = (props) => {
  let navigate = useNavigate();
  const folderimage = props.folderimage
  const root = props.root
  const path = props.path
  const setView = props.view
  return <span>
    <img className="albumart" src={protocolFilter( folderimage )}></img><span className="button material-icons" onClick={ () => { setView(`browse`); navigate(-1) } }>arrow_back</span><span className="button material-icons" onClick={ () => { setView(`browse`); navigate(1) } }>arrow_forward</span><span className="button material-icons" onClick={ () => { setView(`browse`); navigate(root) } }>home</span><span className="button material-icons" onClick={ () => { setView(`browse`) } }>folder</span><span className="button material-icons" onClick={ () => { setView(`queue`) } }>queue</span>
  </span>
}

const Loading = () => {
  return <div className="fade-in" style={{ position: "fixed", left: "0px", top: "0px", width: "100%", height: "100vh" , display: "flex", justifyContent: "center", alignItems: "center" }}>... loading ...</div>
}

const MediaBrowser =  (props:any) => {
  let navigate = useNavigate();
  let location = useLocation();
  // let params = useParams();  // for parsing id and id2 from the router "/browse/:id/:id2/", etc...
  let path:any = location.pathname //.replace( /^\/browse/, "" ); path = path == "" ? "/" : path;

  // the heavy hand
  let [__rerender, __setRerender] = useState(0);      function render() { __setRerender(__rerender+1); }

  // player state:
  let [listing, setListing] = useState( [] );
  let [progressamt, setProgressAmt] = useState(player.progressamt);
  let [track, setTrack] = useState(player.playing.track);
  let [mode, setMode] = useState(player.mode);
  let [player_state, setPlayerTransport] = useState("paused");
  let [folderimage, setFolderImage] = useState(icon);
  let [loading, setLoading] = useState(false);
  let [view, setView] = useState("browse");

  useEffect(() => {
    loadBrowserLocalStorage().then( () => {
      console.log( "load: lastURL", localStorage.getItem( "lastURL" ) )
      if (localStorage.getItem( "lastURL" )) {
        path = localStorage.getItem( "lastURL" );
        console.log( "RESTORING URL", path )
        navigate( path );
      }
      player.onNavigate = (url) => { navigate( `${url}` ); }
      player.onProgressChange = (p) => { setProgressAmt( p ) };
      player.onTrackChange = (t, i, l) => { setTrack( t ) };
      player.onPlayerTransportChange = (state) => { setPlayerTransport(state) };   /* init */ setPlayerTransport( player.isPlaying() ? "playing" : "paused" )
      player.onModeChange = (mode) => { setMode( mode ) };
      window.addEventListener("keydown", (e) => player.onKeyDown( e ) );
      console.log('mounted');
    })
    return () => {
      window.removeEventListener("keydown", (e) => player.onKeyDown( e ) );
      console.log('====================UNMOUNT======================');
      player.release();
      saveBrowserLocalStorage();
    }
  }, [])  // <-- add this empty array here,    [] -> only called on mount/unmount (once ever)

  useEffect( () => {
      async function doAsyncStuff() {
        setLoading( true );

        // pull a new browser listing
        console.log( `[browse] URL: ${location.pathname}${location.search}` );
        console.log( `[browse] dir( "${path}" )` );
        localStorage.setItem( "lastURL", path );
        // console.log( "save: lastURL", localStorage.getItem( "lastURL" ) )
        let l = await window.electron.invoke( "mediafs", "dir", path, undefined, false );
        let curdir = l.filter( r => r.path == "." );
        l = l.filter( r => r.path != "." && r.path != ".." && !r.path.match( /^\./ ) );
        setListing( l );
        setFolderImage( curdir.length > 0 && curdir[0].image ? curdir[0].image.match( /default/ ) ? icon : curdir[0].image : icon )
        //console.log( JSON.stringify( l, null, 1 ) );

        setLoading( false );
        await saveBrowserLocalStorage(); // periodically commit any changes to disk...
      }
      doAsyncStuff();
      return () => { /*cleanup*/}
    },
    [location.pathname], // [args, ...] rerun when any of these change.   [] -> only on mount/unmount (once ever)
  );
  // useLayoutEffect( () => {
  //     return () => {/*cleanup*/}
  //   },
  //   [mode, audio, playing, playing.track, progressamt, currentTime, playing.listing, playing.i], // [args, ...] rerun when any of these change.   [] -> only on mount/unmount (once ever)
  // );


  let dom2 = (
    <div className="listing" onMouseUp={() => { player.progress_manipulating = false }} >

    <Header path={path} root="" folderimage={folderimage} view={setView}></Header>
    {loading && <Loading></Loading>}
    {view == "browse" && !loading &&
      <span>
        <div onClick={() => navigate(path)}>media:{path}</div>
        <MediaList path={path} listing={listing} player_state={player_state} track={track} click_play={ (...args:any) => { player.click( ...args )} }></MediaList>
      </span>
    }
    {view == "queue" && !loading &&
      <span>
        <div>[NOW PLAYING]</div>
        <MediaList path={path} listing={player.playing.listing} player_state={player_state} track={track} click_play={ (...args:any) => { player.click( ...args )} }></MediaList>
      </span>
    }

    {track && <MediaFooter track={track} player_state={player_state} mode={mode} progressamt={progressamt}></MediaFooter>}
    </div>
  );

  return dom2;
};

export default function App() {
  return (
    <Router>
      <Routes>
        {/* <Route path="/queue/*" element={<MediaQueue />}></Route> */}
        <Route path="*" element={<MediaBrowser />}></Route>
        {/* <Route path="*" element={ <Navigate to="/browse" /> }></Route> */}
      </Routes>
    </Router>
  );
}
