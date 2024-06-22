function toggleAndSaveTheme() {
  console.log(" 🕹️ The user changed prefered theme");
  $("body").toggleClass("bg-light bg-dark");
  $(".theme-btn").toggleClass("btn-light btn-dark");
  $(".theme-btn").html(function (i, html) {
    return html === "💡 &nbsp; Light" ? "❍ &nbsp; Dark" : "💡 &nbsp; Light";
  });
  $("#normal-text-div").toggleClass("text-light text-dark");
  $(".span-text").toggleClass("text-info text-primary");

  console.log("Saving theme into 💾 localStorage");
  const isDarkTheme = $("body").hasClass("bg-dark");
  const theme = isDarkTheme ? "dark" : "light";
  localStorage.setItem("theme", theme);
}

function setDarkTheme() {
  console.log("Setting to ⬛ Dark Theme");
  $("body").addClass("bg-dark").removeClass("bg-light");
  $(".theme-btn").addClass("btn-light").removeClass("btn-dark");
  $("#normal-text-div").addClass("text-light").removeClass("text-dark");
  $(".span-text").addClass("text-primary").removeClass("text-info");
  $(".theme-btn").html("💡 &nbsp; Light");
}

function setLightTheme() {
  console.log("Setting to ⬜ Light Theme");
  $("body").addClass("bg-light").removeClass("bg-dark");
  $(".theme-btn").addClass("btn-dark").removeClass("btn-light");
  $("#normal-text-div").addClass("text-dark").removeClass("text-light");
  $(".span-text").addClass("text-info").removeClass("text-primary");
  $(".theme-btn").html("❍ &nbsp; Dark");
}

$(function () {
  const theme = localStorage.getItem("theme");
  const isPrefferedThemeDark = theme === "dark";
  const isSystemDark = window.matchMedia("(prefers-color-scheme: dark)");

  console.log("isSystemDark: ", isSystemDark);
  console.log("isPrefferedThemeDark: ", isPrefferedThemeDark);

  if ((!theme && isSystemDark ) || (theme && isPrefferedThemeDark)) {
    setDarkTheme();
  } else {
    setLightTheme();
  }
});
