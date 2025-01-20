# NoesisGUI XAML Tools Changelog
 
## [0.1.54] - 2024-01-20

- [LangServer] Added support for SolidColorBrush in CapabilityColor
- [LangServer] Added support for ContentPropertyMetaData in CapabilityColor
- [LangServer] Fixed crashing when a ResourceDictionary with MergedDictionaries is set to a type which does not exist
- [LangServer] Fixed completion failing when XAML contains an expression with an embedded expression as it's parameter
- [LangServer] Fixed crashes when completing a resource key where a resource with no valid type exists
- [LangServer] Updated LangServer to Noesis 3.2.7
 
## [0.1.53] - 2024-09-04

- [LangServer] Added multi-client support to LangServer and NoesisGUI Tools
- [LangServer] Added completion of Binding property values ([#3178](https://www.noesisengine.com/bugs/view.php?id=3178))
- [LangServer] Added completion of TargetType, AncestorType, and DataType, property values ([#3178](https://www.noesisengine.com/bugs/view.php?id=3178))
- [LangServer] Added completion of TargetName, ElementName, and SourceName, property values ([#3178](https://www.noesisengine.com/bugs/view.php?id=3178))
- [LangServer] Added completion of Setter Property and Value properties
- [LangServer] Added color decorator support to Setter Value property
- [LangServer] Added handling of periods in completion of property names and resource keys
- [LangServer] Added sorting of completion results
- [LangServer] Added ClientPort to LangServer, allowing for connection to a specific server
- [LangServer] Improved LangServer network discovery, removing broadcast UPD messages
- [LangServer] Fixed GPU memory leak in D3D11 embedded LangServer
- [LangServer] Fixed expression property completion adding invalid quotation marks
- [LangServer] Fixed missing color completion and decorator, in Color element content values 
- [LangServer] Fixed value completion in node properties
- [LangServer] Fixed color decorator using invalid metadata in some cases
- [LangServer] Fixed color decorators disappearing when the document contains an empty color value
- [LangServer] Fixed completion not working for read-only collection properties
- [LangServer] Fixed some root completion snippets having the final jump point at the end of the document
- [LangServer] Updated LangServer to Noesis 3.2.5
 
## [0.0.49] - 2024-06-20

- [LangServer] Added completion for expressions (Binding, StaticResource etc.), including types, and properties ([#3178](https://www.noesisengine.com/bugs/view.php?id=3178))
- [LangServer] Added completion of resource keys for StaticResource and DynamicResource extensions ([#3178](https://www.noesisengine.com/bugs/view.php?id=3178))
- [LangServer] Fixed incorrect positions displayed for some errors
- [LangServer] Updated LangServer to Noesis 3.2.4
 
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