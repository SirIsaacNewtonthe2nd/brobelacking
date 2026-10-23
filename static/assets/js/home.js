let inFrame;

try {
  inFrame = window !== top;
} catch (e) {
  inFrame = true;
}
if (!localStorage.getItem("ab")) localStorage.setItem("ab", true);

// Site the about:blank tab opens through the proxy on launch
const launchUrl = "https://www.google.com/";

// Opens the site inside an about:blank tab and sends this tab elsewhere.
// Returns false if the browser blocked the popup.
function openCloak() {
  const popup = open("about:blank", "_blank");
  if (!popup || popup.closed) return false;

  const doc = popup.document;
  const iframe = doc.createElement("iframe");
  const style = iframe.style;
  const link = doc.createElement("link");

  // Tab shows "about:blank" with a blank icon unless a custom cloak is set in settings
  const name = localStorage.getItem("name") || "about:blank";
  const icon =
    localStorage.getItem("icon") ||
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  doc.title = name;
  link.rel = "icon";
  link.href = icon;

  iframe.src = `/rx?launch=${encodeURIComponent(launchUrl)}`;
  style.position = "fixed";
  style.top = style.bottom = style.left = style.right = 0;
  style.border = style.outline = "none";
  style.width = style.height = "100%";

  doc.head.appendChild(link);
  doc.body.style.margin = 0;
  doc.body.appendChild(iframe);

  const script = doc.createElement("script");
  script.textContent = `
    window.onbeforeunload = function (event) {
      const confirmationMessage = 'Leave Site?';
      (event || window.event).returnValue = confirmationMessage;
      return confirmationMessage;
    };
  `;
  doc.head.appendChild(script);

  const pLink = localStorage.getItem(encodeURI("pLink")) || getRandomUrl();
  location.replace(pLink);
  return true;
}

// Browsers block popups that aren't triggered by a click, so if the automatic
// open fails, cover the page and open the tab on the first click instead.
function showLaunchOverlay() {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#000;color:#fff;font-family:sans-serif;cursor:pointer;text-align:center;padding:16px";
  overlay.innerHTML =
    '<div style="font-size:24px">Click anywhere to launch</div><div style="font-size:14px;opacity:.7">Allow popups for this site to skip this step next time.</div>';
  overlay.addEventListener("click", () => {
    if (openCloak()) overlay.remove();
  });
  document.body.appendChild(overlay);
}

if (!inFrame && localStorage.getItem("ab") === "true") {
  if (!openCloak()) {
    if (document.body) showLaunchOverlay();
    else document.addEventListener("DOMContentLoaded", showLaunchOverlay);
  }
}
// Particles
document.addEventListener("DOMContentLoaded", event => {
  if (window.localStorage.getItem("Particles") === "true") {
    const particlesConfig = {
      particles: {
        number: {
          value: 200,
          density: {
            enable: true,
            value_area: 600,
          },
        },
        color: {
          value: "#ffffff",
        },
        shape: {
          type: "circle",
          stroke: {
            width: 0,
            color: "#000000",
          },
          polygon: {
            nb_sides: 5,
          },
          image: {
            src: "img/github.svg",
            width: 100,
            height: 100,
          },
        },
        opacity: {
          value: 1,
          random: true,
          anim: {
            enable: false,
            speed: 1,
            opacity_min: 0.1,
            sync: false,
          },
        },
        size: {
          value: 3,
          random: true,
          anim: {
            enable: false,
            speed: 40,
            size_min: 0.1,
            sync: false,
          },
        },
        line_linked: {
          enable: false,
          distance: 150,
          color: "#ffffff",
          opacity: 0.4,
          width: 1,
        },
        move: {
          enable: true,
          speed: 2,
          direction: "bottom",
          random: true,
          straight: false,
          out_mode: "out",
          bounce: false,
          attract: {
            enable: false,
            rotateX: 600,
            rotateY: 1200,
          },
        },
      },
      interactivity: {
        detect_on: "canvas",
        events: {
          onhover: {
            enable: true,
            mode: "repulse",
          },
          onclick: {
            enable: false,
            mode: "push",
          },
          resize: true,
        },
        modes: {
          grab: {
            distance: 400,
            line_linked: {
              opacity: 1,
            },
          },
          bubble: {
            distance: 400,
            size: 40,
            duration: 2,
            opacity: 8,
            speed: 3,
          },
          repulse: {
            distance: 40,
            duration: 0.4,
          },
          push: {
            particles_nb: 4,
          },
          remove: {
            particles_nb: 2,
          },
        },
      },
      retina_detect: true,
    };
    particlesJS("particles-js", particlesConfig);
  }
});
// Splash texts
const SplashT = [
  "Over 8 Million Users since 2023",
  "Fastest growing proxy server",
  "Made by xBubbo",
  "Check out discord.gg/interstellar :)",
  "Thanks for using the site",
  "Follow us on Tiktok (@useinterstellar)",
  "Subscribe to us on YouTube (@unblocking)",
  "Subscribe to my Youtube (@xbubbo)",
  "Check out the settings page",
  "Check out our Patreon (https://www.patreon.com/gointerstellar)",
];

let SplashI = Math.floor(Math.random() * SplashT.length);
const SplashE = document.getElementById("splash");

function US() {
  SplashI = (SplashI + 1) % SplashT.length;
  SplashE.innerText = SplashT[SplashI];
}

SplashE.innerText = SplashT[SplashI];

SplashE.addEventListener("click", US);
// Random URL
function getRandomUrl() {
  const randomUrls = [
    "https://kahoot.it",
    "https://classroom.google.com",
    "https://drive.google.com",
    "https://google.com",
    "https://docs.google.com",
    "https://slides.google.com",
    "https://www.nasa.gov",
    "https://blooket.com",
    "https://clever.com",
    "https://edpuzzle.com",
    "https://khanacademy.org",
    "https://wikipedia.org",
    "https://dictionary.com",
  ];
  return randomUrls[randRange(0, randomUrls.length)];
}

function randRange(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}
