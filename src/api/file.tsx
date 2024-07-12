enum FileType {
    PDF = "PDF",
    ZIP = "ZIP",
    JPG = "JPG",

}


export class File {

    name: string
    fileType: FileType

    constructor(name: string, fileType: FileType) {
        this.name = name;
        this.fileType = fileType;
    }

    get icon() {

        switch (this.fileType) {
            case FileType.PDF:
                return <i className="bi bi-file-earmark-pdf"></i>
            case FileType.ZIP:
                return <i className="bi bi-file-earmark-zip"></i>
            case FileType.JPG:
                return <i className="bi bi-filetype-jpg"></i>
            default:
                throw new Error(`Illegal FileType variant '${this.fileType}'`);
        };


    }

}