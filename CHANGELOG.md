# NoesisGUI XAML Tools Changelog
 
## [0.0.47] - 2024-02-06

- [LangServer] Added XAML Preview support to Unity and Unreal
- [LangServer] Fixed namespace processing ([#2773](https://www.noesisengine.com/bugs/view.php?id=2773))
- [LangServer] Updated LangServer to Noesis 3.2.3
 
## [0.0.45] - 2023-10-03

- [LangServer] Fixed crashes in the XAML parser ([#2624](https://www.noesisengine.com/bugs/view.php?id=2624), [#2672](https://www.noesisengine.com/bugs/view.php?id=2672))
- [LangServer] Updated LangServer to Noesis 3.2.2

## [0.0.44] - 2023-06-13

- [LangServer] Fixed local fonts whose paths begin with "./"
 
## [0.0.43] - 2023-06-07

- [LangServer] Added contextual snippet support for attribute keys and values ([#2561](https://www.noesisengine.com/bugs/view.php?id=2561))
- [LangServer] Error message Uris no longer contain the "lsfile" scheme
- [LangServer] Error message Uris for untitled documents now begin with an "/&#60;Untitled&#62;/" folder

## [0.0.42] - 2023-05-09

- [LangServer] Added Color suggestions for Color properties to LangServer ([#2556](https://www.noesisengine.com/bugs/view.php?id=2556))
- [LangServer] Added Null value to completion results for nullable attribute properties in LangServer ([#2555](https://www.noesisengine.com/bugs/view.php?id=2555))
- [LangServer] Added support for Nullable types to LangServer completion capabilities ([#2555](https://www.noesisengine.com/bugs/view.php?id=2555))
- [LangServer] Added bool completion entries for attribute properties in LangServer ([#2555](https://www.noesisengine.com/bugs/view.php?id=2555))
- [LangServer] Fixed completion results being returned for empty documents in LangServer ([#2554](https://www.noesisengine.com/bugs/view.php?id=2554))
- [LangServer] Implemented full support for color decorators on node attribute properties ([#2566](https://www.noesisengine.com/bugs/view.php?id=2566))
- [LangServer] Added hardcoded snippets to completion request results in LangServer ([#2561](https://www.noesisengine.com/bugs/view.php?id=2561))
- [LangServer] Improved the positioning of XAML document errors