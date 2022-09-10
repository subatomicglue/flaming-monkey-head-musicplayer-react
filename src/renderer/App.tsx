
import { contextBridge, ipcRenderer, IpcRendererEvent, MouseInputEvent } from 'electron';
import { MouseEventHandler, SyntheticEvent, useEffect, useLayoutEffect, useMutationEffect, useState } from "react";
import { Link, NavLink, Outlet, MemoryRouter as Router, Routes, Route, useSearchParams, useParams,
  useNavigate,
  useLocation, } from 'react-router-dom'; // https://github.com/remix-run/react-router/blob/main/docs/getting-started/tutorial.md

import './App.css';
import 'material-icons';
//import 'bootstrap';
import icon from '/assets/icon.svg';
import defaultpng from "/assets/default.png"; // auto copy the default icon over to the build folder
const xhr = require('xhrjs/xhr').init( XMLHttpRequest ).xhr;
const xhrAuth = require('xhrjs/xhr').init( XMLHttpRequest ).xhrAuth;
//import xhr from "xhrjs/xhr.js";

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



class Player {
  progress_manipulating:boolean = false;
  playing:any = { i: 0, listing: [], track: undefined };//{ title: "1", artist: "2", album: "3", path: "4", abs_path: "bok", image: defaultpng } };
  currentTime:string = "03:45:65";
  progressamt:string = "0%";
  mode:number = 0;
  timer:any;
  audio:any = undefined;
  onTrackChange = (track, i, listing) => {};
  onPlayerTransportChange = (state) => {};
  onModeChange = (mode) => {};
  onNavigate = (navigate) => {};
  onProgressChange = (progress_amt) => {};
  onListingChange = (l) => {};

  release() {
    if (this.audio) delete this.audio;
  }

  onKeyDown(e) {
    if(e.keyCode === 13) {
        console.log('Enter key pressed')
    }
  }

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
    if (!this.playing.track) return;

    // play a stopped track
    if (!this.audio) { this.playAudio( this.playing.track, this.playing.index, this.playing.listing ); console.log( "play stopped", this.playing.index ); return; }

    // unpause existing track
    this.audio.volume = 1;
    this.audio.play();
    this.updateTrackTime();

    // timer = setInterval( () => {
    //   currentTime = HomeComponent.formatTime( audio.currentTime );
    // }, 1000 );
  }
  track_pause() {
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
        console.log( "[track_inc:playAudio]", next_i );
      }
      else {
        // allow index to go off the end of the dir listing...
        this.playing.index = inc < 0 ? -1 : this.playing.listing.length;
        this.killAudio();
        console.log( "[track_inc:killAudio]", this.playing.index );
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
    this.playing.track = f;
    this.playing.listing = listing;
    console.log( "[playAudio]", i );

    //console.log( "xhr", f.content );
    //let data = await xhr( "GET", "res://" + f.content,  {}/*{'Content-Type': 'application/octet-stream' }*/ );
    //data = data.body
    //let data = await window.electron.invoke( 'readFileSync', f.content );
    //console.log( data )
    //return;

    this.audio = new Audio();
    //this.audio.src = data;
    this.audio.src = protocolFilter( f.content );
    this.audio.load();

    // auto next track, when track ends:
    this.audio.onended = (event) => {
      if (this.audio == undefined) return;

      this.audio.volume = 0;

      let i = this.playing.index;
      let next_i = i;
      console.log( "Track Ended (processing repeat mode): ", this.modes[this.mode] );
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

    // ramp the audio to silence before it ends...
    let volume_ramp_granularity = 0.01;
    let volume_ramp_time = 0.12;
    if (this.timer) clearInterval( this.timer );
    this.timer = setInterval( () => {
      if (this.audio && this.audio.duration < (this.audio.currentTime + volume_ramp_time)) {
        this.audio.volume = 0;
      }
    }, volume_ramp_granularity * 1000 );

    this.track_play();
    this.scrollTo( "item" + i )
    console.log( "play", i, f, listing )
    this.onTrackChange( f, i, listing );
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
      console.log( "[changeroute]", f.abs_path, f.type, i );
      this.onNavigate( f.abs_path )
    } else {
      this.playAudio( f, i, listing )
    }
  }
}

let player = new Player();

const MediaBrowser =  () => {
  let navigate = useNavigate();
  let location = useLocation();
  let params = useParams();
  let path = location.pathname;

  // the heavy hand
  let [__rerender, __setRerender] = useState(0);      function render() { __setRerender(__rerender+1); }

  // player state:
  let [listing, setListing] = useState( [] );
  let [progressamt, setProgressAmt] = useState(player.progressamt);
  let [track, setTrack] = useState(player.playing.track);
  let [mode, setMode] = useState(player.mode);
  let [player_state, setPlayerTransport] = useState("paused");
  let [folderimage, setFolderImage] = useState(icon);

  console.log( "url path:", location.pathname );

  useEffect(() => {
    player.onNavigate = (url) => { navigate( url ); }
    player.onProgressChange = (p) => { setProgressAmt( p ) };
    player.onTrackChange = (t, i, l) => { setTrack( t ) };
    player.onPlayerTransportChange = (state) => { setPlayerTransport(state) };
    player.onModeChange = (mode) => { setMode( mode ) };
    console.log('mounted');
    return () => {
      console.log('====================UNMOUNT======================');
      player.release();
    }
  }, [])  // <-- add this empty array here

  useEffect( () => {
      async function doAsyncStuff() {
        let l = await window.electron.invoke( "mediafs", "dir", location.pathname, undefined, false );
        let curdir = l.filter( r => r.path == "." );
        l = l.filter( r => r.path != "." );
        setListing( l );
        setFolderImage( curdir.length > 0 && curdir[0].image ? curdir[0].image.match( /default/ ) ? icon : curdir[0].image : icon )
        console.log( "URL:", location.pathname );
        console.log( JSON.stringify( l, null, 1 ) );
        //console.log( listing ? listing.map( r => JSON.stringify( r ) + "\n" ) : "null" );
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
    <div className="listing" onKeyPress={(e) => player.onKeyDown( e )}  onMouseUp={() => { player.progress_manipulating = false }} >

    <img className="albumart" src={protocolFilter( folderimage )}></img><span className="button material-icons" onClick={ () => { navigate(-1) } }>arrow_back</span><span className="button material-icons" onClick={ () => { navigate("/") } }>home</span>

    {(listing ? listing : []).map( (f:any, i:number) => (
      <div key={"item" + i} id={"item" + i} onClick={() => { f.path == '..' ? player.click( { abs_path: path + '/..', type: 'dir' }, i, listing ) : player.click( f, i, listing ) }} className="listitem">

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
    ))}


    {track &&
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
          </div>
        </div>
      </div>
    }

    {track &&
      <div id="progress-bar" className="progress-bar" onMouseMove={(e) => player.progressMove(e)} onMouseDown={ (e)=> player.progressStart(e)} onMouseUp={ (e) => player.progressEnd(e) }><div id="progress-amt" className="progress-amt" style={{ 'width': progressamt }}>&nbsp;</div></div>
    }

  </div>
  );

  return dom2;
};

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="*" element={<MediaBrowser />}>
        </Route>
      </Routes>
    </Router>
  );
}
