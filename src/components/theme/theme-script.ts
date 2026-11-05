export const themeBootScript = `(function(){
  var pref = document.documentElement.getAttribute("data-theme-pref") || "system";
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function resolve(choice){
    if (choice === "dark" || choice === "light") return choice;
    return media.matches ? "dark" : "light";
  }
  function apply(){
    var choice = document.documentElement.getAttribute("data-theme-pref") || "system";
    document.documentElement.setAttribute("data-theme", resolve(choice));
  }
  apply();
  media.addEventListener("change", function(){
    if ((document.documentElement.getAttribute("data-theme-pref") || "system") === "system") apply();
  });
})();`;
