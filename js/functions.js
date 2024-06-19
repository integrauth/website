function toggleTheme() {
  $("body").toggleClass("bg-light bg-dark");
  $(".theme-btn").toggleClass("btn-light btn-dark");
  $(".theme-btn").html(function (i, html) {
    return html === "💡 &nbsp; Light" ? "❍ &nbsp; Dark" : "💡 &nbsp; Light";
  });
  $("#normal-text-div").toggleClass("text-light text-dark");
  $(".span-text").toggleClass("text-info text-primary");
}

function setDarkTheme() {
  $("body").addClass("bg-dark").removeClass("bg-light");
  $(".theme-btn").addClass("btn-light").removeClass("btn-dark");
  $("#normal-text-div").addClass("text-light").removeClass("text-dark");
  $(".span-text").addClass("text-primary").removeClass("text-info");
  $(".theme-btn").html("💡 &nbsp; Light");
}

function setLightTheme() {
  $("body").addClass("bg-light").removeClass("bg-dark");
  $(".theme-btn").addClass("btn-dark").removeClass("btn-light");
  $("#normal-text-div").addClass("text-dark").removeClass("text-light");
  $(".span-text").addClass("text-info").removeClass("text-primary");
  $(".theme-btn").html("❍ &nbsp; Dark");
}

function setDefaultTheme() {
  const darkTheme = window.matchMedia("(prefers-color-scheme: dark)");

  if (darkTheme.matches) {
    setDarkTheme();
  } else {
    setLightTheme();
  }
}

$(function () {
  setDefaultTheme();
});
