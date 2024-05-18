function toggleTheme() {
  $("body").toggleClass("bg-light bg-dark");
  $(".theme-btn").toggleClass("btn-light btn-dark");
  $(".theme-btn").html(function (i, html) {
    return html === "💡 &nbsp; Light" ? "❍ &nbsp; Dark" : "💡 &nbsp; Light";
  });
  $("#normal-text-div").toggleClass("text-light text-dark");
  $(".span-text").toggleClass("text-info text-primary");
}
